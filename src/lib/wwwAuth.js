export const WWW_ORIGIN = 'https://www.yundev.space';

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

export async function refreshSession(
  fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
) {
  const csrf = readCsrfCookie();
  if (!csrf || typeof fetchImpl !== 'function') {
    return false;
  }

  try {
    const response = await fetchImpl(`${WWW_ORIGIN}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-csrf-token': csrf,
      },
    });
    return response.status === 200;
  } catch {
    return false;
  }
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
