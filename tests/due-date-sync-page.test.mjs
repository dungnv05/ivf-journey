import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSession } from '../src/lib/wwwAuth.js';
import {
  createDueDateApi,
  decideAfterFailure,
  getSyncLaterUser,
  isSyncLaterFor,
  resolveLocalForUser,
  setSyncLaterUser,
  shouldClearOnSignOut,
} from '../src/lib/dueDateSync.js';
import { createSaveQueue } from '../src/lib/dueDateSaveQueue.js';

const REFRESH_SLOT_KEY = Symbol.for('yundev.auth.refresh.v1');

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function resetRefreshEnv(cookie = 'csrf=test-csrf') {
  delete globalThis[REFRESH_SLOT_KEY];
  globalThis.document = { cookie };
}

function restoreDocument(originalDocument) {
  delete globalThis[REFRESH_SLOT_KEY];
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, delay) {
      const id = nextId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runAll() {
      const entries = Array.from(timers.entries());
      timers.clear();
      for (const [, entry] of entries) {
        entry.fn();
      }
    },
    pendingCount() {
      return timers.size;
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('refreshSession shares inFlight slot across concurrent calls and clears on settle', async () => {
  const originalDocument = globalThis.document;
  try {
    resetRefreshEnv('csrf=abc');
    let fetchCount = 0;
    let resolveFetch;
    const fetchImpl = () => {
      fetchCount += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    };

    const p1 = refreshSession({ fetchImpl, now: () => 5000 });
    const p2 = refreshSession({ fetchImpl, now: () => 5001 });
    assert.equal(fetchCount, 1);
    assert.ok(globalThis[REFRESH_SLOT_KEY].inFlight);

    resolveFetch(jsonResponse(200, {}));
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'ok');
    assert.equal(r2, 'ok');
    assert.equal(globalThis[REFRESH_SLOT_KEY].inFlight, null);
  } finally {
    restoreDocument(originalDocument);
  }
});

test('refreshSession short-circuits within 2000ms of last ok', async () => {
  const originalDocument = globalThis.document;
  try {
    resetRefreshEnv('csrf=abc');
    let nowMs = 10000;
    let fetchCount = 0;
    const fetchImpl = async () => {
      fetchCount += 1;
      return jsonResponse(200, {});
    };

    assert.equal(
      await refreshSession({ fetchImpl, now: () => nowMs }),
      'ok',
    );
    assert.equal(fetchCount, 1);

    nowMs = 11999;
    assert.equal(
      await refreshSession({ fetchImpl, now: () => nowMs }),
      'ok',
    );
    assert.equal(fetchCount, 1);

    nowMs = 12000;
    assert.equal(
      await refreshSession({ fetchImpl, now: () => nowMs }),
      'ok',
    );
    assert.equal(fetchCount, 2);
  } finally {
    restoreDocument(originalDocument);
  }
});

test('refreshSession returns retry on 409, failed on 500/throw, and failed without csrf', async () => {
  const originalDocument = globalThis.document;
  try {
    resetRefreshEnv('csrf=abc');
    assert.equal(
      await refreshSession({
        fetchImpl: async () => jsonResponse(409, {}),
        now: () => 1000,
      }),
      'retry',
    );
    assert.equal(
      globalThis[REFRESH_SLOT_KEY].lastOkAt,
      Number.NEGATIVE_INFINITY,
    );

    assert.equal(
      await refreshSession({
        fetchImpl: async () => jsonResponse(500, {}),
        now: () => 1000,
      }),
      'failed',
    );

    assert.equal(
      await refreshSession({
        fetchImpl: async () => {
          throw new Error('network');
        },
        now: () => 1000,
      }),
      'failed',
    );

    resetRefreshEnv('');
    let called = false;
    assert.equal(
      await refreshSession({
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, {});
        },
        now: () => 1000,
      }),
      'failed',
    );
    assert.equal(called, false);
  } finally {
    restoreDocument(originalDocument);
  }
});

test('createDueDateApi 401 with refresh retry then ok retries request once with jitter', async () => {
  let fetchCount = 0;
  const refreshOutcomes = ['retry', 'ok'];
  const sleepCalls = [];

  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      return jsonResponse(200, {
        ok: true,
        dueDate: '2026-09-01',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => refreshOutcomes.shift(),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    random: () => 0.5,
  });

  const res = await api.get();
  assert.equal(res.kind, 'ok');
  assert.equal(res.dueDate, '2026-09-01');
  assert.equal(fetchCount, 2);
  assert.deepEqual(sleepCalls, [275]);
});

test('createDueDateApi 401 with refresh retry then failed returns unauthorized', async () => {
  let fetchCount = 0;
  const refreshOutcomes = ['retry', 'failed'];
  const sleepCalls = [];

  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(401, { error: 'unauthorized' });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => refreshOutcomes.shift(),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    random: () => 0,
  });

  const res = await api.get();
  assert.deepEqual(res, { kind: 'unauthorized' });
  assert.equal(fetchCount, 1);
  assert.deepEqual(sleepCalls, [150]);
});

test('createSaveQueue debounces rapid schedule calls and sends null for empty string', async () => {
  const fakeTimers = createFakeTimers();
  const puts = [];
  const doneCalls = [];

  const queue = createSaveQueue({
    put: async (val) => {
      puts.push(val);
      return { kind: 'ok', dueDate: val, updatedAt: null };
    },
    getCurrentUserId: () => 'user-1',
    expectedUserId: 'user-1',
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    onDone: (res, sent) => doneCalls.push({ res, sent }),
  });

  queue.schedule('2026-01-01');
  queue.schedule('2026-01-02');
  queue.schedule('2026-01-03');
  queue.schedule('2026-01-04');
  queue.schedule('2026-01-05');
  assert.equal(fakeTimers.pendingCount(), 1);

  fakeTimers.runAll();
  await flushMicrotasks();
  assert.deepEqual(puts, ['2026-01-05']);
  assert.equal(doneCalls.length, 1);
  assert.equal(doneCalls[0].sent, '2026-01-05');

  queue.schedule('');
  fakeTimers.runAll();
  await flushMicrotasks();
  assert.deepEqual(puts, ['2026-01-05', null]);
});

test('createSaveQueue sends latest value scheduled during in-flight put and drops intermediates', async () => {
  const fakeTimers = createFakeTimers();
  const puts = [];
  const doneCalls = [];
  let resolveFirstPut;

  const queue = createSaveQueue({
    put: (val) => {
      puts.push(val);
      if (puts.length === 1) {
        return new Promise((resolve) => {
          resolveFirstPut = resolve;
        });
      }
      return Promise.resolve({ kind: 'ok', dueDate: val, updatedAt: null });
    },
    getCurrentUserId: () => 'user-1',
    expectedUserId: 'user-1',
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    onDone: (res, sent) => doneCalls.push({ res, sent }),
  });

  queue.schedule('2026-02-01');
  fakeTimers.runAll();
  assert.deepEqual(puts, ['2026-02-01']);

  queue.schedule('2026-02-02');
  queue.schedule('2026-02-03');
  fakeTimers.runAll();
  assert.deepEqual(puts, ['2026-02-01']);
  assert.equal(doneCalls.length, 0);

  resolveFirstPut({ kind: 'ok', dueDate: '2026-02-01', updatedAt: null });
  await flushMicrotasks();
  assert.deepEqual(puts, ['2026-02-01', '2026-02-03']);
  assert.equal(doneCalls.length, 1);
  assert.equal(doneCalls[0].sent, '2026-02-03');
});

test('createSaveQueue aborts with user_changed when userId mismatches before put', async () => {
  const fakeTimers = createFakeTimers();
  let currentUser = 'user-1';
  let putCalled = false;
  const doneCalls = [];

  const queue = createSaveQueue({
    put: async () => {
      putCalled = true;
      return { kind: 'ok', dueDate: '2026-03-01', updatedAt: null };
    },
    getCurrentUserId: () => currentUser,
    expectedUserId: 'user-1',
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    onDone: (res) => doneCalls.push(res),
  });

  queue.schedule('2026-03-01');
  currentUser = 'user-2';
  fakeTimers.runAll();
  await flushMicrotasks();

  assert.equal(putCalled, false);
  assert.deepEqual(doneCalls, [{ kind: 'user_changed' }]);
});

test('createSaveQueue drops pending value on put failure and ignores late result after cancel', async () => {
  const fakeTimers = createFakeTimers();
  let resolvePut;
  const doneCalls = [];
  let mode = 'fail';

  const queue = createSaveQueue({
    put: () => {
      if (mode === 'fail') {
        return Promise.resolve({ kind: 'offline' });
      }
      return new Promise((resolve) => {
        resolvePut = resolve;
      });
    },
    getCurrentUserId: () => 'user-1',
    expectedUserId: 'user-1',
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    onDone: (res, sent) => doneCalls.push({ res, sent }),
  });

  queue.schedule('2026-04-01');
  fakeTimers.runAll();
  queue.schedule('2026-04-02');
  await flushMicrotasks();
  assert.equal(doneCalls.length, 1);
  assert.deepEqual(doneCalls[0].res, { kind: 'offline' });
  fakeTimers.runAll();
  await flushMicrotasks();
  assert.equal(doneCalls.length, 1);

  mode = 'pending';
  queue.schedule('2026-04-03');
  fakeTimers.runAll();
  queue.cancel();
  resolvePut({ kind: 'ok', dueDate: '2026-04-03', updatedAt: null });
  await flushMicrotasks();
  assert.equal(doneCalls.length, 1);
});

test('decideAfterFailure handles unchanged server, changed server, and unknown lastSynced', () => {
  assert.equal(
    decideAfterFailure({
      local: '2026-05-01',
      server: null,
      lastSynced: '',
    }),
    'upload_local',
  );
  assert.equal(
    decideAfterFailure({
      local: '2026-05-01',
      server: '',
      lastSynced: null,
    }),
    'upload_local',
  );
  assert.equal(
    decideAfterFailure({
      local: '',
      server: null,
      lastSynced: '',
    }),
    'in_sync',
  );
  assert.equal(
    decideAfterFailure({
      local: '',
      server: '2026-05-01',
      lastSynced: '2026-05-01',
    }),
    'upload_local',
  );
  assert.equal(
    decideAfterFailure({
      local: '2026-05-01',
      server: '2026-06-01',
      lastSynced: '2026-05-01',
    }),
    'conflict',
  );
  assert.equal(
    decideAfterFailure({
      local: '',
      server: '2026-06-01',
      lastSynced: '2026-05-01',
    }),
    'apply_server',
  );
  assert.equal(
    decideAfterFailure({
      local: '2026-05-01',
      server: null,
      lastSynced: '2026-04-01',
    }),
    'offer_upload',
  );
  assert.equal(
    decideAfterFailure({
      local: '2026-05-01',
      server: null,
      lastSynced: undefined,
    }),
    'offer_upload',
  );
});

test('shouldClearOnSignOut and resolveLocalForUser truth tables', () => {
  assert.equal(
    shouldClearOnSignOut({
      prevState: 'signed-in',
      nextState: 'signed-out',
      owner: '',
    }),
    true,
  );
  assert.equal(
    shouldClearOnSignOut({
      prevState: 'signed-out',
      nextState: 'signed-out',
      owner: 'user-1',
    }),
    true,
  );
  assert.equal(
    shouldClearOnSignOut({
      prevState: null,
      nextState: 'signed-out',
      owner: '',
    }),
    false,
  );
  assert.equal(
    shouldClearOnSignOut({
      prevState: 'signed-in',
      nextState: 'loading',
      owner: 'user-1',
    }),
    false,
  );
  assert.equal(
    shouldClearOnSignOut({
      prevState: 'signed-in',
      nextState: 'signed-in',
      owner: 'user-1',
    }),
    false,
  );

  assert.equal(
    resolveLocalForUser({
      local: '2026-05-01',
      owner: 'user-1',
      userId: 'user-2',
    }),
    '',
  );
  assert.equal(
    resolveLocalForUser({
      local: '2026-05-01',
      owner: 'user-1',
      userId: 'user-1',
    }),
    '2026-05-01',
  );
  assert.equal(
    resolveLocalForUser({
      local: '2026-05-01',
      owner: '',
      userId: 'user-1',
    }),
    '2026-05-01',
  );
});

test('sync-later helpers scope per user and ignore storage errors', () => {
  const map = new Map();
  const storage = {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
  };

  setSyncLaterUser(storage, 'user-a');
  assert.equal(getSyncLaterUser(storage), 'user-a');
  assert.equal(isSyncLaterFor(storage, 'user-a'), true);
  assert.equal(isSyncLaterFor(storage, 'user-b'), false);

  const brokenStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  setSyncLaterUser(brokenStorage, 'user-a');
  assert.equal(getSyncLaterUser(brokenStorage), '');
  assert.equal(isSyncLaterFor(brokenStorage, 'user-a'), false);
  assert.equal(isSyncLaterFor(null, 'user-a'), false);
});
