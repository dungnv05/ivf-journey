import { WWW_ORIGIN, readCsrfCookie, refreshSession } from './wwwAuth.js';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_ISO_DATE = '2020-01-01';
const MAX_ISO_DATE = '2100-12-31';

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

export function decideDueDateSync({ local, server }) {
  const localNorm = typeof local === 'string' && local ? local : '';
  const serverNorm = typeof server === 'string' && server ? server : '';

  if (!localNorm && !serverNorm) return 'none';
  if (localNorm === serverNorm) return 'in_sync';
  if (!localNorm && serverNorm) return 'apply_server';
  if (localNorm && !serverNorm) return 'offer_upload';
  return 'conflict';
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createDueDateApi({
  fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
  readCsrf = readCsrfCookie,
  refresh = refreshSession,
  base = WWW_ORIGIN,
} = {}) {
  const endpoint = `${base}/api/pregnancy`;

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
        let refreshed = false;
        try {
          refreshed = Boolean(await refresh());
        } catch {
          refreshed = false;
        }
        if (!refreshed) {
          return { kind: 'unauthorized' };
        }
        continue;
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
