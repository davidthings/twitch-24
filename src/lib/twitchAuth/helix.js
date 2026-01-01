import { getAccessToken } from './tokenStorage';
import { getClientId } from './oauth';

const API_BASE = 'https://api.twitch.tv/helix';

const HELIX_LOG_KEY = 't24_helix_latest_v1';

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function readHelixLog() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HELIX_LOG_KEY);
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return null;
    return parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
  } catch {
    return null;
  }
}

function writeHelixLog(obj) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HELIX_LOG_KEY, JSON.stringify(obj));
  } catch {
  }
}

function logHelixCall({ path, query, url, ok, status, durationMs, errorText, responseJson }) {
  const now = Date.now();
  const prev = readHelixLog();
  const byPath = prev && typeof prev.byPath === 'object' ? prev.byPath : {};

  const entry = {
    ts: now,
    path,
    query,
    url,
    ok: Boolean(ok),
    status: typeof status === 'number' ? status : null,
    durationMs: typeof durationMs === 'number' ? durationMs : null,
    errorText: errorText ? String(errorText) : null,
    response: responseJson && typeof responseJson === 'object' ? responseJson : null,
  };

  writeHelixLog({
    version: 1,
    ts: now,
    byPath: {
      ...byPath,
      [String(path || '')]: entry,
    },
  });
}

export async function apiGet(path, query = {}) {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const url = new URL(`${API_BASE}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach((vv) => {
        if (vv !== undefined && vv !== null && vv !== '') url.searchParams.append(k, String(vv));
      });
      return;
    }
    if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, String(v));
  });

  const startedAt = Date.now();

  const res = await fetch(url.toString(), {
    headers: {
      'Client-Id': getClientId(),
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    const bodyJson = isJson ? await res.json().catch(() => null) : null;
    const bodyText = !isJson ? await res.text().catch(() => '') : '';

    // Special-case: Helix returns 404 with message "segments were not found" when a broadcaster
    // has no schedule configured. Treat as empty schedule rather than an error.
    if (
      path === '/schedule' &&
      res.status === 404 &&
      bodyJson &&
      typeof bodyJson === 'object' &&
      String(bodyJson.message || '').toLowerCase().includes('segments were not found')
    ) {
      const normalized = {
        data: { segments: [] },
        pagination: {},
        _meta: { empty: true, originalError: bodyJson },
      };
      logHelixCall({
        path,
        query,
        url: url.toString(),
        ok: true,
        status: res.status,
        durationMs: Date.now() - startedAt,
        errorText: null,
        responseJson: normalized,
      });
      return normalized;
    }

    const errorText = bodyText || (bodyJson ? JSON.stringify(bodyJson) : '');
    logHelixCall({
      path,
      query,
      url: url.toString(),
      ok: false,
      status: res.status,
      durationMs: Date.now() - startedAt,
      errorText,
      responseJson: bodyJson && typeof bodyJson === 'object' ? bodyJson : null,
    });
    throw new Error(`Helix ${path} failed: ${res.status} ${errorText}`);
  }

  const json = await res.json();
  logHelixCall({
    path,
    query,
    url: url.toString(),
    ok: true,
    status: res.status,
    durationMs: Date.now() - startedAt,
    errorText: null,
    responseJson: json,
  });
  return json;
}

export async function getMe() {
  return apiGet('/users');
}
