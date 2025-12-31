const STORAGE_KEY = 't24_timeline_config_v1';

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function loadTimelineConfig() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed.ok) return null;
  const v = parsed.value;
  return v && typeof v === 'object' ? v : null;
}

export function saveTimelineConfig(cfg) {
  if (typeof window === 'undefined') return;
  const next = cfg && typeof cfg === 'object' ? cfg : {};
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
