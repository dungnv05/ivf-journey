import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsrfCookie } from '../src/lib/wwwAuth.js';
import {
  createDueDateApi,
  decideDueDateSync,
  isValidIsoDate,
} from '../src/lib/dueDateSync.js';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

test('isValidIsoDate validates format, calendar date, and range', () => {
  assert.equal(isValidIsoDate('2025-05-15'), true);
  assert.equal(isValidIsoDate('2020-01-01'), true);
  assert.equal(isValidIsoDate('2100-12-31'), true);
  assert.equal(isValidIsoDate('2024-02-29'), true);

  assert.equal(isValidIsoDate('2025-02-30'), false);
  assert.equal(isValidIsoDate('2019-12-31'), false);
  assert.equal(isValidIsoDate('2101-01-01'), false);
  assert.equal(isValidIsoDate('2025-1-01'), false);
  assert.equal(isValidIsoDate(null), false);
});

test('decideDueDateSync covers all 5 outcomes', () => {
  assert.equal(decideDueDateSync({ local: '', server: null }), 'none');
  assert.equal(decideDueDateSync({ local: null, server: '' }), 'none');
  assert.equal(
    decideDueDateSync({ local: '2026-03-01', server: '2026-03-01' }),
    'in_sync',
  );
  assert.equal(
    decideDueDateSync({ local: '', server: '2026-03-01' }),
    'apply_server',
  );
  assert.equal(
    decideDueDateSync({ local: '2026-03-01', server: null }),
    'offer_upload',
  );
  assert.equal(
    decideDueDateSync({ local: '2026-03-01', server: '2026-04-01' }),
    'conflict',
  );
});

test('readCsrfCookie extracts exact csrf cookie value', () => {
  assert.equal(readCsrfCookie('a=1; csrf=abc; csrfx=no'), 'abc');
  assert.equal(readCsrfCookie('a=1; csrfx=no'), '');
  assert.equal(readCsrfCookie(''), '');
});

test('createDueDateApi GET ok', async () => {
  const calls = [];
  const api = createDueDateApi({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        ok: true,
        dueDate: '2026-06-15',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
    base: 'https://www.yundev.space',
  });

  const res = await api.get();
  assert.deepEqual(res, {
    kind: 'ok',
    dueDate: '2026-06-15',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.yundev.space/api/pregnancy');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.body, undefined);
});

test('createDueDateApi GET 503 disabled returns disabled', async () => {
  const api = createDueDateApi({
    fetchImpl: async () =>
      jsonResponse(503, { error: 'due_date_sync_disabled' }),
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
  });

  assert.deepEqual(await api.get(), { kind: 'disabled' });
});

test('createDueDateApi GET 401 refreshes once and retries ok', async () => {
  let fetchCount = 0;
  let refreshCount = 0;
  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      return jsonResponse(200, {
        ok: true,
        dueDate: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => {
      refreshCount += 1;
      return true;
    },
  });

  const res = await api.get();
  assert.deepEqual(res, {
    kind: 'ok',
    dueDate: null,
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(fetchCount, 2);
  assert.equal(refreshCount, 1);
});

test('createDueDateApi GET 401 with refresh false returns unauthorized', async () => {
  let fetchCount = 0;
  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(401, { error: 'unauthorized' });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
  });

  assert.deepEqual(await api.get(), { kind: 'unauthorized' });
  assert.equal(fetchCount, 1);
});

test('createDueDateApi GET 401 twice returns unauthorized', async () => {
  let fetchCount = 0;
  let refreshCount = 0;
  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(401, { error: 'unauthorized' });
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => {
      refreshCount += 1;
      return true;
    },
  });

  assert.deepEqual(await api.get(), { kind: 'unauthorized' });
  assert.equal(fetchCount, 2);
  assert.equal(refreshCount, 1);
});

test('createDueDateApi PUT sends csrf header, credentials include, and body', async () => {
  const calls = [];
  const api = createDueDateApi({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        ok: true,
        dueDate: '2026-08-20',
        updatedAt: '2026-01-03T00:00:00.000Z',
      });
    },
    readCsrf: () => 'secret-csrf',
    refresh: async () => false,
  });

  const res = await api.put('2026-08-20');
  assert.deepEqual(res, {
    kind: 'ok',
    dueDate: '2026-08-20',
    updatedAt: '2026-01-03T00:00:00.000Z',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(calls[0].init.headers, {
    'content-type': 'application/json',
    'x-csrf-token': 'secret-csrf',
  });
  assert.equal(calls[0].init.body, JSON.stringify({ dueDate: '2026-08-20' }));
});

test('createDueDateApi PUT with empty csrf returns unauthorized without calling fetch', async () => {
  let fetchCalled = false;
  const api = createDueDateApi({
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse(200, { ok: true, dueDate: null, updatedAt: null });
    },
    readCsrf: () => '',
    refresh: async () => true,
  });

  assert.deepEqual(await api.put('2026-08-20'), { kind: 'unauthorized' });
  assert.equal(fetchCalled, false);
});

test('createDueDateApi returns offline when fetch throws', async () => {
  const api = createDueDateApi({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
  });

  assert.deepEqual(await api.get(), { kind: 'offline' });
});

test('createDueDateApi returns unavailable when response dueDate is invalid', async () => {
  const api = createDueDateApi({
    fetchImpl: async () =>
      jsonResponse(200, { ok: true, dueDate: 'bad', updatedAt: null }),
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
  });

  assert.deepEqual(await api.get(), { kind: 'unavailable' });
});

test('createDueDateApi returns unavailable on 429', async () => {
  const api = createDueDateApi({
    fetchImpl: async () => jsonResponse(429, { error: 'rate_limited' }),
    readCsrf: () => 'csrf-123',
    refresh: async () => false,
  });

  assert.deepEqual(await api.get(), { kind: 'unavailable' });
});
