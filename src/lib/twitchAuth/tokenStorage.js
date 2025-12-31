const KEY = 't24_twitch_token_v1';

export function saveToken(token) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(token));
  } catch {
    // ignore
  }
}

export function loadToken() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t && typeof t.expires_at === 'number' && Date.now() > t.expires_at) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function getAccessToken() {
  const t = loadToken();
  return t?.access_token || null;
}
