let cachedAppToken = null;
let cachedAppTokenExpiresAtMs = 0;

async function getTwitchAppAccessToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId) throw new Error('TWITCH_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('TWITCH_CLIENT_SECRET is not set');

  const now = Date.now();
  if (cachedAppToken && cachedAppTokenExpiresAtMs - now > 60_000) {
    return cachedAppToken;
  }

  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Twitch app access token: ${res.status} ${text}`);
  }

  const json = await res.json();
  const accessToken = json.access_token;
  const expiresInSec = json.expires_in;

  if (!accessToken || !expiresInSec) {
    throw new Error('Unexpected Twitch token response');
  }

  cachedAppToken = accessToken;
  cachedAppTokenExpiresAtMs = Date.now() + expiresInSec * 1000;

  return accessToken;
}

async function twitchAppFetch(path, { method = 'GET', query, body } = {}) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error('TWITCH_CLIENT_ID is not set');

  const token = await getTwitchAppAccessToken();

  const url = new URL(`https://api.twitch.tv/helix/${path.replace(/^\//, '')}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Twitch API error ${method} ${url.pathname}: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

async function getTwitchUserByLogin(login) {
  const normalized = String(login || '').trim().toLowerCase();
  if (!normalized) return null;

  const json = await twitchAppFetch('users', { query: { login: normalized } });
  const user = Array.isArray(json?.data) ? json.data[0] : null;
  if (!user) return null;

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
  };
}

export { getTwitchAppAccessToken, twitchAppFetch, getTwitchUserByLogin };
