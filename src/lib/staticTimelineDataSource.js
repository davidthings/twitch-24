import { loadChannels, saveChannels } from './staticChannels';
import { loadTimelineConfig, saveTimelineConfig } from './staticTimelineConfig';
import { apiGet } from './twitchAuth/helix';

const dayMs = 24 * 60 * 60 * 1000;

const CACHE_KEY = 't24_static_timeline_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CHANNEL_CACHE_TTL_MS = 20 * 60 * 1000;

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function loadCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return null;
    return parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
  } catch {
    return null;
  }
}

function saveCache(obj) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
  }
}

function ensureCacheV2(raw) {
  if (!raw || typeof raw !== 'object') {
    return { version: 2, ts: Date.now(), channels: {} };
  }
  if (raw.version === 2 && raw.channels && typeof raw.channels === 'object') {
    return raw;
  }
  return {
    version: 2,
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
    ...(raw.key ? { key: raw.key } : {}),
    ...(raw.data ? { data: raw.data } : {}),
    channels: {},
  };
}

function parseDurationSeconds(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const m = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const sec = m[3] ? Number(m[3]) : 0;
  const total = h * 3600 + min * 60 + sec;
  return Number.isFinite(total) ? total : null;
}

async function withConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(limit || 1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function resolveBroadcasterIds(channels) {
  const missing = channels.filter((c) => c.login && !c.broadcasterId);
  if (!missing.length) return channels;

  const byLogin = new Map(channels.map((c) => [c.login, c]));
  const logins = missing.map((c) => c.login);

  const batchSize = 100;
  for (let i = 0; i < logins.length; i += batchSize) {
    const batch = logins.slice(i, i + batchSize);
    const json = await apiGet('/users', { login: batch });
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const u of data) {
      const login = String(u?.login || '').trim().toLowerCase();
      const id = String(u?.id || '').trim();
      const displayName = String(u?.display_name || '').trim();
      const ch = byLogin.get(login);
      if (!ch) continue;
      if (id) ch.broadcasterId = id;
      if (displayName && (!ch.displayName || ch.displayName === ch.login)) {
        ch.displayName = displayName;
      }
    }
  }

  return channels;
}

async function fetchScheduleSegments({ selectedChannels, windowStartIso, windowEndIso }) {
  const out = [];

  const ws = new Date(windowStartIso).getTime();
  const we = new Date(windowEndIso).getTime();

  await withConcurrency(selectedChannels, 4, async (c) => {
    if (!c.broadcasterId) return;
    try {
      const windowStartMs = Number.isFinite(ws) ? ws : Date.now();
      const startMs = Math.max(Date.now(), windowStartMs);
      const startIso = new Date(startMs).toISOString();

      let cursor = null;
      for (let page = 0; page < 20; page += 1) {
        const json = await apiGet('/schedule', {
          broadcaster_id: c.broadcasterId,
          ...(cursor ? { after: cursor } : { start_time: startIso }),
          first: 25,
        });

        const segs = Array.isArray(json?.data?.segments) ? json.data.segments : [];
        const nextCursor = String(json?.pagination?.cursor || '').trim() || null;

        let maxStart = null;
        for (const s of segs) {
          const start = String(s?.start_time || '');
          const end = String(s?.end_time || '');
          if (!start || !end) continue;

          const st = new Date(start).getTime();
          const en = new Date(end).getTime();

          if (Number.isFinite(st)) {
            maxStart = maxStart === null ? st : Math.max(maxStart, st);
          }

          if (Number.isFinite(st) && Number.isFinite(we) && st >= we) continue;
          if (Number.isFinite(en) && Number.isFinite(ws) && en <= ws) continue;

          out.push({
            id: String(s?.id || ''),
            channelId: c.id,
            title: String(s?.title || ''),
            startTimeIso: start,
            endTimeIso: end,
            isCanceled: Boolean(s?.canceled_until),
          });
        }

        if (!nextCursor) break;
        if (!segs.length) break;
        if (maxStart !== null && Number.isFinite(we) && maxStart >= we) break;
        cursor = nextCursor;
      }
    } catch {
      // If schedule requires extra scopes or isn't available, just skip it.
    }
  });

  return out;
}

async function fetchVideos({ selectedChannels, windowStartIso, windowEndIso }) {
  const out = [];
  const ws = new Date(windowStartIso).getTime();
  const we = new Date(windowEndIso).getTime();

  await withConcurrency(selectedChannels, 4, async (c) => {
    if (!c.broadcasterId) return;
    try {
      let cursor = null;
      let minStartMs = null;

      for (let page = 0; page < 12; page += 1) {
        const json = await apiGet('/videos', {
          user_id: c.broadcasterId,
          first: 100,
          type: 'archive',
          sort: 'time',
          ...(cursor ? { after: cursor } : null),
        });

        const vids = Array.isArray(json?.data) ? json.data : [];
        const nextCursor = String(json?.pagination?.cursor || '').trim() || null;

        for (const v of vids) {
          const startedAtIso = String(v?.created_at || v?.published_at || '');
          if (!startedAtIso) continue;
          const st = new Date(startedAtIso).getTime();
          if (!Number.isFinite(st)) continue;

          minStartMs = minStartMs === null ? st : Math.min(minStartMs, st);

          const durationSeconds = parseDurationSeconds(v?.duration);
          const en = durationSeconds !== null ? st + durationSeconds * 1000 : null;

          // filter to window (simple overlap)
          if (st >= we) continue;
          if (en !== null && en <= ws) continue;

          out.push({
            id: String(v?.id || v?.video_id || ''),
            channelId: c.id,
            title: String(v?.title || ''),
            url: String(v?.url || ''),
            startedAtIso,
            endedAtIso: en !== null ? new Date(en).toISOString() : null,
            viewCount: Number.isFinite(Number(v?.view_count)) ? Number(v.view_count) : null,
          });
        }

        if (!nextCursor) break;
        if (!vids.length) break;
        if (minStartMs !== null && Number.isFinite(ws) && minStartMs <= ws) break;
        cursor = nextCursor;
      }
    } catch {
    }
  });

  return out;
}

export function createStaticTimelineDataSource() {
  return {
    async loadConfig() {
      return loadTimelineConfig();
    },

    async saveConfig(next) {
      saveTimelineConfig(next);
    },

    async loadTimelineData({ originMs, pastDays, futureDays, channelIds }) {
      const origin = Number.isFinite(Number(originMs)) ? Number(originMs) : Date.now();
      const past = Number.isFinite(Number(pastDays)) ? Number(pastDays) : 10;
      const future = Number.isFinite(Number(futureDays)) ? Number(futureDays) : 5;

      const all = loadChannels();
      const enabled = all.filter((c) => c.isEnabled);
      const enabledSet = new Set(enabled.map((c) => c.id));

      const selected =
        channelIds === null
          ? enabled.map((c) => c.id)
          : Array.isArray(channelIds)
            ? channelIds.map((s) => String(s || '').trim()).filter(Boolean)
            : enabled.map((c) => c.id);

      const selectedFiltered = selected.filter((id) => enabledSet.has(id));

      const windowStartMs = Math.floor((origin - past * dayMs) / dayMs) * dayMs;
      const windowEndMs = Math.ceil((origin + future * dayMs) / dayMs) * dayMs;

      const windowStart = new Date(windowStartMs);
      const windowEnd = new Date(windowEndMs);

      const windowStartIso = windowStart.toISOString();
      const windowEndIso = windowEnd.toISOString();

      const cacheKey = JSON.stringify({
        selected: selectedFiltered.slice().sort(),
        ws: windowStartIso,
        we: windowEndIso,
      });
      const cached = loadCache();
      const now = Date.now();
      if (cached && cached.key === cacheKey && typeof cached.ts === 'number' && now - cached.ts < CACHE_TTL_MS && cached.data) {
        return cached.data;
      }

      const allMutable = loadChannels();
      const enabledMutable = allMutable.filter((c) => c.isEnabled);
      const selectedChannels = enabledMutable.filter((c) => selectedFiltered.includes(c.id));

      // Resolve broadcaster IDs if missing (stored back into localStorage for reuse)
      await resolveBroadcasterIds(enabledMutable);
      saveChannels(allMutable);

      const cacheV2 = ensureCacheV2(cached);
      const channelCache = cacheV2.channels && typeof cacheV2.channels === 'object' ? cacheV2.channels : {};

      const scheduleSegments = [];
      const videos = [];
      const missingChannels = [];

      for (const c of selectedChannels) {
        const entry = channelCache[c.id];
        const okEntry =
          entry &&
          typeof entry === 'object' &&
          typeof entry.ts === 'number' &&
          typeof entry.wsMs === 'number' &&
          typeof entry.weMs === 'number' &&
          now - entry.ts < CHANNEL_CACHE_TTL_MS &&
          entry.wsMs <= windowStartMs &&
          entry.weMs >= windowEndMs;

        if (!okEntry) {
          missingChannels.push(c);
          continue;
        }

        const segs = Array.isArray(entry.scheduleSegments) ? entry.scheduleSegments : [];
        const vids = Array.isArray(entry.videos) ? entry.videos : [];
        for (const s of segs) scheduleSegments.push(s);
        for (const v of vids) videos.push(v);
      }

      if (missingChannels.length) {
        const fetchedSchedule = await fetchScheduleSegments({ selectedChannels: missingChannels, windowStartIso, windowEndIso });
        const fetchedVideos = await fetchVideos({ selectedChannels: missingChannels, windowStartIso, windowEndIso });

        const segsByChannel = new Map();
        for (const s of fetchedSchedule) {
          const cid = String(s?.channelId || '');
          if (!cid) continue;
          if (!segsByChannel.has(cid)) segsByChannel.set(cid, []);
          segsByChannel.get(cid).push(s);
          scheduleSegments.push(s);
        }

        const vidsByChannel = new Map();
        for (const v of fetchedVideos) {
          const cid = String(v?.channelId || '');
          if (!cid) continue;
          if (!vidsByChannel.has(cid)) vidsByChannel.set(cid, []);
          vidsByChannel.get(cid).push(v);
          videos.push(v);
        }

        for (const c of missingChannels) {
          channelCache[c.id] = {
            ts: now,
            wsMs: windowStartMs,
            weMs: windowEndMs,
            scheduleSegments: segsByChannel.get(c.id) || [],
            videos: vidsByChannel.get(c.id) || [],
          };
        }

        cacheV2.ts = now;
        cacheV2.channels = channelCache;
        saveCache(cacheV2);
      }

      const data = {
        ok: true,
        originMs: origin,
        pastDays: past,
        futureDays: future,
        windowStart: windowStartIso,
        windowEnd: windowEndIso,
        channels: enabledMutable,
        selectedChannelIds: channelIds === null ? null : selectedFiltered,
        scheduleSegments,
        videos,
      };

      cacheV2.key = cacheKey;
      cacheV2.ts = now;
      cacheV2.data = data;
      cacheV2.channels = channelCache;
      saveCache(cacheV2);
      return data;

    },

    async reorderChannel({ channelId, direction }) {
      const dir = String(direction || '');
      if (dir !== 'up' && dir !== 'down') {
        return { ok: false, error: 'Invalid direction' };
      }

      const channels = loadChannels();
      const idx = channels.findIndex((c) => c.id === channelId);
      if (idx < 0) return { ok: false, error: 'Channel not found' };

      const otherIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (otherIdx < 0 || otherIdx >= channels.length) return { ok: true, moved: false };

      const next = channels.slice();
      const tmp = next[idx];
      next[idx] = next[otherIdx];
      next[otherIdx] = tmp;

      saveChannels(next.map((c, i) => ({ ...c, sortOrder: i })));
      return { ok: true, moved: true };
    },
  };
}
