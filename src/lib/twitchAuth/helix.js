import { getAccessToken } from './tokenStorage';
import { getClientId } from './oauth';

const API_BASE = 'https://api.twitch.tv/helix';

export async function apiGet(path, query = {}) {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = new URL(`${API_BASE}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: {
      'Client-Id': getClientId(),
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Helix ${path} failed: ${res.status} ${txt}`);
  }

  return await res.json();
}

export async function getMe() {
  return apiGet('/users');
}
