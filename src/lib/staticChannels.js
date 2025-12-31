const STORAGE_KEY = 't24_channels_v1';

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
  }
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeColorHex(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^#[0-9a-fA-F]{6}$/);
  return m ? s.toLowerCase() : null;
}

function normalizeChannel(raw, idx = 0) {
  const login = String(raw?.login || '').trim().toLowerCase();
  const displayName = String(raw?.displayName || '').trim();
  const timeZone = String(raw?.timeZone || '').trim();

  const id = String(raw?.id || '').trim() || login || makeId();

  return {
    id,
    login,
    displayName: displayName || login,
    colorHex: normalizeColorHex(raw?.colorHex),
    timeZone: timeZone || null,
    isEnabled: raw?.isEnabled === false ? false : true,
    sortOrder: Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : idx,
  };
}

function normalizeChannels(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const normalized = arr.map((c, i) => normalizeChannel(c, i));
  normalized.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return normalized.map((c, i) => ({ ...c, sortOrder: i }));
}

export function loadChannels() {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  const parsed = safeParseJson(raw);
  if (!parsed.ok) return [];

  if (Array.isArray(parsed.value)) {
    return normalizeChannels(parsed.value);
  }

  if (parsed.value && typeof parsed.value === 'object' && Array.isArray(parsed.value.channels)) {
    return normalizeChannels(parsed.value.channels);
  }

  return [];
}

export function saveChannels(channels) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeChannels(channels);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function exportChannelsJson(channels) {
  const normalized = normalizeChannels(channels);
  return JSON.stringify({ channels: normalized, version: 1 }, null, 2);
}

export function importChannelsJson(text) {
  const parsed = safeParseJson(text);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const v = parsed.value;
  const channels = Array.isArray(v) ? v : v && typeof v === 'object' ? v.channels : null;
  if (!Array.isArray(channels)) {
    return { ok: false, error: 'Expected JSON array or { channels: [] }' };
  }

  const normalized = normalizeChannels(channels);
  return { ok: true, channels: normalized };
}
