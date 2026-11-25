export const WWW_ORIGIN = 'https://www.yundev.space';

const REFRESH_SLOT_KEY = Symbol.for('yundev.auth.refresh.v1');

function getRefreshSlot() {
  let slot = globalThis[REFRESH_SLOT_KEY];
  if (!slot || typeof slot !== 'object') {
    slot = {
      inFlight: null,
      lastOkAt: Number.NEGATIVE_INFINITY,
    };
    globalThis[REFRESH_SLOT_KEY] = slot;
  }
  return slot;
}

export function readCsrfCookie(
  cookieString = typeof document !== 'undefined' ? document.cookie : '',
) {
  if (typeof cookieString !== 'string' || !cookieString) {
    return '';
  }

  const parts = cookieString.split(';');
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const name = part.slice(0, eqIndex).trim();
    if (name === 'csrf') {
      return part.slice(eqIndex + 1).trim();
    }
  }

  return '';
}

export function refreshSession({
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const slot = getRefreshSlot();
  if (now() - slot.lastOkAt < 2000) {
    return Promise.resolve('ok');
  }
  if (slot.inFlight) {
    return slot.inFlight;
  }

  const csrf = readCsrfCookie();
  if (!csrf || typeof fetchImpl !== 'function') {
    return Promise.resolve('failed');
  }

  const promise = (async () => {
    try {
      const response = await fetchImpl(`${WWW_ORIGIN}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrf,
        },
      });
      if (response.status === 200) {
        slot.lastOkAt = now();
        return 'ok';
      }
      if (response.status === 409) {
        return 'retry';
      }
      return 'failed';
    } catch {
      return 'failed';
    }
  })();

  slot.inFlight = promise;
  return promise.finally(() => {
    if (slot.inFlight === promise) {
      slot.inFlight = null;
    }
  });
}

export function getHeaderAuth() {
  const el =
    typeof document !== 'undefined'
      ? document.querySelector('yun-header')
      : null;

  if (!el || el.state === 'loading') {
    return { state: 'loading', userId: null };
  }

  if (
    el.state === 'signed-in' &&
    typeof el.user?.id === 'string' &&
    el.user.id.length > 0
  ) {
    return { state: 'signed-in', userId: el.user.id };
  }

  return { state: 'signed-out', userId: null };
}

export function onHeaderAuthChange(cb) {
  if (typeof document === 'undefined' || typeof cb !== 'function') {
    return () => {};
  }

  let active = true;
  const handler = () => {
    if (active) cb();
  };

  document.addEventListener('yh-auth-change', handler);

  if (
    typeof customElements !== 'undefined' &&
    typeof customElements.whenDefined === 'function'
  ) {
    customElements
      .whenDefined('yun-header')
      .then(() => {
        if (active) cb();
      })
      .catch(() => {});
  }

  return () => {
    active = false;
    document.removeEventListener('yh-auth-change', handler);
  };
}
