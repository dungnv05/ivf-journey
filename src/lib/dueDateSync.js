import { WWW_ORIGIN, readCsrfCookie, refreshSession } from './wwwAuth.js';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_ISO_DATE = '2020-01-01';
const MAX_ISO_DATE = '2100-12-31';

export const SYNC_LATER_STORAGE_KEY = 'ivf_thaigiao_due_sync_later_v1';

export function isValidIsoDate(s) {
  if (typeof s !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(s);
  if (!match) return false;
  if (s < MIN_ISO_DATE || s > MAX_ISO_DATE) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function normalizeDate(value) {
  return typeof value === 'string' && value ? value : '';
}

export function decideDueDateSync({ local, server }) {
  const localNorm = normalizeDate(local);
  const serverNorm = normalizeDate(server);

  if (!localNorm && !serverNorm) return 'none';
  if (localNorm === serverNorm) return 'in_sync';
  if (!localNorm && serverNorm) return 'apply_server';
  if (localNorm && !serverNorm) return 'offer_upload';
  return 'conflict';
}

export function decideAfterFailure({ local, server, lastSynced }) {
  if (lastSynced === undefined) {
    return decideDueDateSync({ local, server });
  }

  const localNorm = normalizeDate(local);
  const serverNorm = normalizeDate(server);
  const lastSyncedNorm = normalizeDate(lastSynced);

  if (serverNorm === lastSyncedNorm) {
    return localNorm !== serverNorm ? 'upload_local' : 'in_sync';
  }

  return decideDueDateSync({ local, server });
}

export function shouldClearOnSignOut({ prevState, nextState, owner }) {
  if (nextState !== 'signed-out') return false;
  if (prevState === 'signed-in') return true;
  if (typeof owner === 'string' && owner.length > 0) return true;
  return false;
}

export function decideSessionEnd({ trigger, confirm, hasUnconfirmedEdit }) {
  if (trigger === 'logout') {
    return 'clear';
  }
  if (trigger === 'expired') {
    return hasUnconfirmedEdit ? 'keep_notice' : 'clear';
  }
  if (trigger === 'signed-out') {
    if (confirm === 'confirmed') {
      return hasUnconfirmedEdit ? 'keep_notice' : 'clear';
    }
    return 'keep';
  }
  return 'keep';
}

export function resolveLocalForUser({ local, owner, userId }) {
  if (typeof owner === 'string' && owner.length > 0 && owner !== userId) {
    return '';
  }
  return typeof local === 'string' ? local : '';
}

export function getSyncLaterUser(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return '';
    return storage.getItem(SYNC_LATER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setSyncLaterUser(storage, userId) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    storage.setItem(SYNC_LATER_STORAGE_KEY, userId);
  } catch {
    // Ignore storage errors
  }
}

export function isSyncLaterFor(storage, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  return getSyncLaterUser(storage) === userId;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRefreshOk(outcome) {
  return outcome === 'ok' || outcome === true;
}

export function createDueDateApi({
  fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
  readCsrf = readCsrfCookie,
  refresh = refreshSession,
  base = WWW_ORIGIN,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  const endpoint = `${base}/api/pregnancy`;

  async function runRefresh() {
    try {
      return await refresh();
    } catch {
      return 'failed';
    }
  }

  async function requestWithRetry(buildInit) {
    let attemptedRefresh = false;

    while (true) {
      const init = buildInit();
      if (!init) {
        return { kind: 'unauthorized' };
      }

      let response;
      try {
        response = await fetchImpl(endpoint, init);
      } catch {
        return { kind: 'offline' };
      }

      if (response.status === 401) {
        if (attemptedRefresh || typeof refresh !== 'function') {
          return { kind: 'unauthorized' };
        }
        attemptedRefresh = true;
        let outcome = await runRefresh();
        if (isRefreshOk(outcome)) {
          continue;
        }
        if (outcome === 'retry') {
          const rawRand = typeof random === 'function' ? random() : Math.random();
          const clampedRand = Number.isFinite(rawRand)
            ? Math.min(1, Math.max(0, rawRand))
            : 0;
          const delayMs = Math.round(150 + clampedRand * 250);
          await sleep(delayMs);
          outcome = await runRefresh();
          if (isRefreshOk(outcome)) {
            continue;
          }
        }
        return { kind: 'unauthorized' };
      }

      if (response.status === 503) {
        const body = await parseJsonSafe(response);
        if (body && body.error === 'due_date_sync_disabled') {
          return { kind: 'disabled' };
        }
        return { kind: 'unavailable' };
      }

      if (
        response.status === 403 ||
        response.status === 429 ||
        response.status >= 500 ||
        !response.ok
      ) {
        return { kind: 'unavailable' };
      }

      const data = await parseJsonSafe(response);
      if (!data || typeof data !== 'object') {
        return { kind: 'unavailable' };
      }

      const { dueDate, updatedAt = null } = data;
      if (dueDate !== null && !isValidIsoDate(dueDate)) {
        return { kind: 'unavailable' };
      }

      return {
        kind: 'ok',
        dueDate,
        updatedAt,
      };
    }
  }

  return {
    get() {
      return requestWithRetry(() => ({
        method: 'GET',
        credentials: 'include',
      }));
    },

    put(dueDate) {
      return requestWithRetry(() => {
        const csrf = typeof readCsrf === 'function' ? readCsrf() : '';
        if (!csrf) {
          return null;
        }
        return {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({ dueDate }),
        };
      });
    },
  };
}
