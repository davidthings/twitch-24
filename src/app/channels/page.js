'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { exportChannelsJson, importChannelsJson, loadChannels, saveChannels } from '@/lib/staticChannels';
import { apiGet } from '@/lib/twitchAuth/helix';
import { toPath } from '@/lib/twitchAuth/oauth';
import { clearToken } from '@/lib/twitchAuth/tokenStorage';
import { useTwitchAuth } from '@/lib/twitchAuth/useTwitchAuth';
import TimeZonePicker from '@/server-app/settings/TimeZonePicker';

function normalizeLogin(s) {
  return String(s || '').trim().toLowerCase();
}

const DEFAULT_CHANNEL_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22c55e', '#38bdf8', '#fb7185', '#f97316', '#94a3b8'];

function hashStringToIndex(str, mod) {
  const s = String(str || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return mod ? hash % mod : hash;
}

function pickDefaultChannelColorHex(existingChannels, seed) {
  const used = new Set(
    (Array.isArray(existingChannels) ? existingChannels : [])
      .map((c) => String(c?.colorHex || '').toLowerCase().trim())
      .filter((x) => x.match(/^#[0-9a-f]{6}$/))
  );

  const base = String(seed || '').trim() || 'seed';
  const startIdx = hashStringToIndex(base, DEFAULT_CHANNEL_COLORS.length);
  for (let i = 0; i < DEFAULT_CHANNEL_COLORS.length; i += 1) {
    const hex = DEFAULT_CHANNEL_COLORS[(startIdx + i) % DEFAULT_CHANNEL_COLORS.length];
    if (!used.has(hex)) return hex;
  }
  return DEFAULT_CHANNEL_COLORS[startIdx];
}

function makeNewChannel({ login, displayName, broadcasterId, colorHex }) {
  const l = normalizeLogin(login);
  return {
    id: l || `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    login: l,
    displayName: String(displayName || '').trim() || l,
    broadcasterId: String(broadcasterId || '').trim() || null,
    colorHex: String(colorHex || '').trim().toLowerCase() || null,
    timeZone: null,
    isEnabled: true,
    sortOrder: 0,
  };
}

function formatDateTimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return '';
  const localMs = ms - d.getTimezoneOffset() * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseTwitchDurationToMs(s) {
  const text = String(s || '').trim();
  if (!text) return 0;
  const m = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  if (![h, min, sec].every((x) => Number.isFinite(x) && x >= 0)) return 0;
  return (h * 60 * 60 + min * 60 + sec) * 1000;
}

function parseTimeOfDayToMinutes(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (![hh, mm].every((x) => Number.isFinite(x))) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesInRange(mins, start, end) {
  if (![mins, start, end].every((x) => Number.isFinite(x))) return false;
  if (start === end) return true;
  if (start < end) return mins >= start && mins <= end;
  return mins >= start || mins <= end;
}

function localMinutesOfDayFromMs(ms) {
  const d = new Date(ms);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function minutesOfDayInTimeZone(ms, timeZone) {
  const tz = String(timeZone || '').trim();
  if (!tz) return localMinutesOfDayFromMs(ms);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || NaN);
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || NaN);
    if (![hh, mm].every((x) => Number.isFinite(x))) return null;
    return hh * 60 + mm;
  } catch {
    return localMinutesOfDayFromMs(ms);
  }
}

function asFiniteNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const DISCOVERY_CACHE_KEY = 't24_channel_discovery_cache_v1';
const DISCOVERY_FILTERS_KEY = 't24_channel_discovery_filters_v1';

function loadDiscoveryFilters() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DISCOVERY_FILTERS_KEY);
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return null;
    const v = parsed.value;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function saveDiscoveryFilters(filters) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISCOVERY_FILTERS_KEY, JSON.stringify(filters));
  } catch {
  }
}

function loadDiscoveryCache(cacheKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DISCOVERY_CACHE_KEY);
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed.ok) return null;
    const v = parsed.value;
    if (!v || typeof v !== 'object') return null;
    if (v.key !== cacheKey) return null;
    if (typeof v.ts !== 'number') return null;
    if (Date.now() - v.ts > 10 * 60 * 1000) return null;
    return v.data || null;
  } catch {
    return null;
  }
}

function saveDiscoveryCache(cacheKey, data) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISCOVERY_CACHE_KEY, JSON.stringify({ key: cacheKey, ts: Date.now(), data }));
  } catch {
  }
}

const VIDEO_TYPE_OPTIONS = [
  { id: 'archive', name: 'VOD (Archive)' },
  { id: 'highlight', name: 'Highlight' },
  { id: 'upload', name: 'Upload' },
  { id: 'all', name: 'All' },
];

const LANGUAGE_OPTIONS = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Spanish' },
  { id: 'fr', name: 'French' },
  { id: 'de', name: 'German' },
  { id: 'pt', name: 'Portuguese' },
  { id: 'it', name: 'Italian' },
  { id: 'ja', name: 'Japanese' },
  { id: 'ko', name: 'Korean' },
  { id: 'ru', name: 'Russian' },
  { id: 'tr', name: 'Turkish' },
  { id: 'zh', name: 'Chinese' },
  { id: 'any', name: 'Any' },
];

function CompactChipPicker({
  label,
  placeholder,
  valueLabel,
  isOpen,
  onOpen,
  onClose,
  query,
  setQuery,
  options,
  onSelect,
  recents,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e) {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <Flex direction="column" gap="1">
        <Text size="2" color="gray">
          {label}
        </Text>
        <Button
          type="button"
          size="1"
          variant={valueLabel ? 'solid' : 'soft'}
          onClick={() => {
            if (isOpen) onClose();
            else onOpen();
          }}
          style={{ justifyContent: 'flex-start' }}
        >
          {valueLabel || placeholder}
        </Button>
      </Flex>

      {isOpen ? (
        <Card style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0, marginTop: 10, width: 320 }}>
          <Flex direction="column" gap="2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: 'inherit',
              }}
            />

            {Array.isArray(recents) && recents.length ? (
              <Flex gap="2" wrap="wrap">
                {recents.map((r) => (
                  <Button key={`recent_${r.id}`} type="button" size="1" variant="soft" onClick={() => onSelect(r)}>
                    {r.name}
                  </Button>
                ))}
              </Flex>
            ) : null}

            {Array.isArray(options) && options.length ? (
              <Flex gap="2" wrap="wrap">
                {options.map((o) => (
                  <Button
                    key={o.id}
                    type="button"
                    size="1"
                    variant="soft"
                    onClick={() => {
                      onSelect(o);
                      onClose();
                    }}
                  >
                    {o.name}
                  </Button>
                ))}
              </Flex>
            ) : (
              <Text size="2" color="gray">
                No matches
              </Text>
            )}
          </Flex>
        </Card>
      ) : null}
    </div>
  );
}

export default function StaticChannelsPage() {
  const auth = useTwitchAuth();
  const [channels, setChannels] = useState([]);
  const [status, setStatus] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');

  const [gameQuery, setGameQuery] = useState('');
  const [gameOptions, setGameOptions] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [recentGames, setRecentGames] = useState([]);

  const [videoTypeQuery, setVideoTypeQuery] = useState('');
  const [selectedVideoType, setSelectedVideoType] = useState(VIDEO_TYPE_OPTIONS[0]);
  const [recentVideoTypes, setRecentVideoTypes] = useState([]);

  const [languageQuery, setLanguageQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGE_OPTIONS[0]);
  const [recentLanguages, setRecentLanguages] = useState([]);

  const [activePicker, setActivePicker] = useState(null);

  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [endStartAt, setEndStartAt] = useState('');
  const [endEndAt, setEndEndAt] = useState('');

  const [startTodEnabled, setStartTodEnabled] = useState(false);
  const [startTodFrom, setStartTodFrom] = useState('10:00');
  const [startTodTo, setStartTodTo] = useState('11:00');
  const [startTodTimeZone, setStartTodTimeZone] = useState('');
  const [endTodEnabled, setEndTodEnabled] = useState(false);
  const [endTodFrom, setEndTodFrom] = useState('16:00');
  const [endTodTo, setEndTodTo] = useState('19:00');
  const [endTodTimeZone, setEndTodTimeZone] = useState('');

  const [minViewCount, setMinViewCount] = useState('1000');
  const [hideExisting, setHideExisting] = useState(true);
  const [sortBy, setSortBy] = useState('maxViewCount');
  const [sortDir, setSortDir] = useState('desc');
  const [discoverStatus, setDiscoverStatus] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverResults, setDiscoverResults] = useState([]);
  const [discoverVods, setDiscoverVods] = useState([]);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const initial = loadChannels();
    setChannels(initial);
    setExportText(exportChannelsJson(initial));

    const saved = loadDiscoveryFilters();
    if (saved) {
      const sg = saved.selectedGame && typeof saved.selectedGame === 'object' ? saved.selectedGame : null;
      const rg = Array.isArray(saved.recentGames) ? saved.recentGames : [];
      const svt = saved.selectedVideoType && typeof saved.selectedVideoType === 'object' ? saved.selectedVideoType : null;
      const rvt = Array.isArray(saved.recentVideoTypes) ? saved.recentVideoTypes : [];
      const sl = saved.selectedLanguage && typeof saved.selectedLanguage === 'object' ? saved.selectedLanguage : null;
      const rl = Array.isArray(saved.recentLanguages) ? saved.recentLanguages : [];

      if (sg && sg.id && sg.name) setSelectedGame({ id: String(sg.id), name: String(sg.name), boxArtUrl: String(sg.boxArtUrl || '') });
      setRecentGames(
        rg
          .map((g) => ({ id: String(g?.id || ''), name: String(g?.name || ''), boxArtUrl: String(g?.boxArtUrl || '') }))
          .filter((g) => g.id && g.name)
          .slice(0, 12)
      );

      if (svt && svt.id && svt.name) setSelectedVideoType({ id: String(svt.id), name: String(svt.name) });
      setRecentVideoTypes(
        rvt
          .map((t) => ({ id: String(t?.id || ''), name: String(t?.name || '') }))
          .filter((t) => t.id && t.name)
          .slice(0, 12)
      );

      if (sl && sl.id && sl.name) setSelectedLanguage({ id: String(sl.id), name: String(sl.name) });
      setRecentLanguages(
        rl
          .map((l) => ({ id: String(l?.id || ''), name: String(l?.name || '') }))
          .filter((l) => l.id && l.name)
          .slice(0, 12)
      );

      if (typeof saved.gameQuery === 'string') setGameQuery(saved.gameQuery);
      if (typeof saved.videoTypeQuery === 'string') setVideoTypeQuery(saved.videoTypeQuery);
      if (typeof saved.languageQuery === 'string') setLanguageQuery(saved.languageQuery);
      if (typeof saved.startAt === 'string') setStartAt(saved.startAt);
      if (typeof saved.endAt === 'string') setEndAt(saved.endAt);
      if (typeof saved.endStartAt === 'string') setEndStartAt(saved.endStartAt);
      if (typeof saved.endEndAt === 'string') setEndEndAt(saved.endEndAt);

      if (typeof saved.startTodEnabled === 'boolean') setStartTodEnabled(saved.startTodEnabled);
      if (typeof saved.startTodFrom === 'string') setStartTodFrom(saved.startTodFrom);
      if (typeof saved.startTodTo === 'string') setStartTodTo(saved.startTodTo);
      if (typeof saved.startTodTimeZone === 'string') setStartTodTimeZone(saved.startTodTimeZone);
      if (typeof saved.endTodEnabled === 'boolean') setEndTodEnabled(saved.endTodEnabled);
      if (typeof saved.endTodFrom === 'string') setEndTodFrom(saved.endTodFrom);
      if (typeof saved.endTodTo === 'string') setEndTodTo(saved.endTodTo);
      if (typeof saved.endTodTimeZone === 'string') setEndTodTimeZone(saved.endTodTimeZone);

      if (saved.minViewCount !== undefined) setMinViewCount(String(saved.minViewCount));
      if (typeof saved.hideExisting === 'boolean') setHideExisting(saved.hideExisting);
      if (typeof saved.sortBy === 'string') setSortBy(saved.sortBy);
      if (typeof saved.sortDir === 'string') setSortDir(saved.sortDir === 'asc' ? 'asc' : 'desc');
    } else {
      const now = Date.now();
      setEndAt(formatDateTimeLocalValue(now));
      setStartAt(formatDateTimeLocalValue(now - 7 * 24 * 60 * 60 * 1000));
      setSelectedVideoType(VIDEO_TYPE_OPTIONS[0]);
      setSelectedLanguage(LANGUAGE_OPTIONS[0]);
    }

    try {
      const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (sys) {
        setStartTodTimeZone((prev) => (prev ? prev : sys));
        setEndTodTimeZone((prev) => (prev ? prev : sys));
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    let timeout = null;
    timeout = setTimeout(() => {
      saveDiscoveryFilters({
        version: 1,
        selectedGame,
        recentGames,
        gameQuery,
        selectedVideoType,
        recentVideoTypes,
        videoTypeQuery,
        selectedLanguage,
        recentLanguages,
        languageQuery,
        startAt,
        endAt,
        endStartAt,
        endEndAt,
        startTodEnabled,
        startTodFrom,
        startTodTo,
        startTodTimeZone,
        endTodEnabled,
        endTodFrom,
        endTodTo,
        endTodTimeZone,
        minViewCount,
        hideExisting,
        sortBy,
        sortDir,
      });
    }, 350);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [
    selectedGame,
    recentGames,
    gameQuery,
    selectedVideoType,
    recentVideoTypes,
    videoTypeQuery,
    selectedLanguage,
    recentLanguages,
    languageQuery,
    startAt,
    endAt,
    endStartAt,
    endEndAt,
    startTodEnabled,
    startTodFrom,
    startTodTo,
    startTodTimeZone,
    endTodEnabled,
    endTodFrom,
    endTodTo,
    endTodTimeZone,
    minViewCount,
    hideExisting,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    const vods = Array.isArray(discoverVods) ? discoverVods : [];

    const startFromMin = parseTimeOfDayToMinutes(startTodFrom);
    const startToMin = parseTimeOfDayToMinutes(startTodTo);
    const endFromMin = parseTimeOfDayToMinutes(endTodFrom);
    const endToMin = parseTimeOfDayToMinutes(endTodTo);

    const channelByUserId = new Map();

    for (const v of vods) {
      if (!v) continue;

      if (startTodEnabled && startFromMin !== null && startToMin !== null) {
        const st = minutesOfDayInTimeZone(v.createdAtMs, startTodTimeZone);
        if (st === null) continue;
        if (!minutesInRange(st, startFromMin, startToMin)) continue;
      }

      if (endTodEnabled && endFromMin !== null && endToMin !== null) {
        const en = minutesOfDayInTimeZone(v.endAtMs, endTodTimeZone);
        if (en === null) continue;
        if (!minutesInRange(en, endFromMin, endToMin)) continue;
      }

      const userId = String(v.userId || '').trim();
      const login = normalizeLogin(v.userLogin);
      const displayName = String(v.userName || '').trim();
      const viewCount = asFiniteNumber(v.viewCount, 0);

      if (!userId || !login) continue;

      const createdAtMs = asFiniteNumber(v.createdAtMs, 0);
      const endAtMs = asFiniteNumber(v.endAtMs, 0);

      const prev = channelByUserId.get(userId) || {
        userId,
        login,
        displayName: displayName || login,
        latestVodAtMs: createdAtMs,
        latestVodEndAtMs: endAtMs,
        vodCount: 0,
        totalViewCount: 0,
        maxViewCount: 0,
        sampleVodUrl: String(v.url || '').trim() || null,
        sampleVodTitle: String(v.title || '').trim() || null,
        sampleVodViewCount: viewCount,
      };

      prev.vodCount += 1;
      prev.totalViewCount += viewCount;
      if (viewCount > (prev.maxViewCount || 0)) {
        prev.maxViewCount = viewCount;
        prev.sampleVodUrl = String(v.url || '').trim() || prev.sampleVodUrl;
        prev.sampleVodTitle = String(v.title || '').trim() || prev.sampleVodTitle;
        prev.sampleVodViewCount = viewCount;
      }

      if (!prev.latestVodAtMs || createdAtMs > prev.latestVodAtMs) {
        prev.latestVodAtMs = createdAtMs;
        prev.latestVodEndAtMs = endAtMs;
      }
      if (!prev.sampleVodUrl) prev.sampleVodUrl = String(v.url || '').trim() || null;
      if (!prev.sampleVodTitle) prev.sampleVodTitle = String(v.title || '').trim() || null;
      if (!prev.displayName || prev.displayName === prev.login) {
        prev.displayName = displayName || prev.login;
      }

      channelByUserId.set(userId, prev);
    }

    const results = Array.from(channelByUserId.values())
      .sort((a, b) => (asFiniteNumber(b.maxViewCount, 0) - asFiniteNumber(a.maxViewCount, 0)) || (asFiniteNumber(b.latestVodAtMs, 0) - asFiniteNumber(a.latestVodAtMs, 0)))
      .slice(0, 200);

    setDiscoverResults(results);
  }, [
    discoverVods,
    startTodEnabled,
    startTodFrom,
    startTodTo,
    startTodTimeZone,
    endTodEnabled,
    endTodFrom,
    endTodTo,
    endTodTimeZone,
  ]);

  useEffect(() => {
    setExportText(exportChannelsJson(channels));
  }, [channels]);

  const enabledCount = useMemo(() => channels.filter((c) => c.isEnabled).length, [channels]);

  const visibleDiscoverResults = useMemo(() => {
    const minViews = asFiniteNumber(minViewCount, 0);
    const rows = Array.isArray(discoverResults) ? discoverResults : [];

    const filtered = rows.filter((r) => {
      if (!r) return false;
      const exists = channels.some((c) => c.login === r.login || (c.broadcasterId && c.broadcasterId === r.userId));
      if (hideExisting && exists) return false;
      if (minViews > 0 && asFiniteNumber(r.maxViewCount, 0) < minViews) return false;
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const ka = sortBy;
      if (ka === 'channel') {
        const aa = String(a.displayName || a.login || '').toLowerCase();
        const bb = String(b.displayName || b.login || '').toLowerCase();
        return aa.localeCompare(bb) * dir;
      }
      if (ka === 'latestVodAtMs') return (asFiniteNumber(a.latestVodAtMs, 0) - asFiniteNumber(b.latestVodAtMs, 0)) * dir;
      if (ka === 'latestVodEndAtMs') return (asFiniteNumber(a.latestVodEndAtMs, 0) - asFiniteNumber(b.latestVodEndAtMs, 0)) * dir;
      if (ka === 'vodCount') return (asFiniteNumber(a.vodCount, 0) - asFiniteNumber(b.vodCount, 0)) * dir;
      if (ka === 'maxViewCount') return (asFiniteNumber(a.maxViewCount, 0) - asFiniteNumber(b.maxViewCount, 0)) * dir;
      return (asFiniteNumber(a.maxViewCount, 0) - asFiniteNumber(b.maxViewCount, 0)) * dir;
    });

    return sorted;
  }, [channels, discoverResults, hideExisting, minViewCount, sortBy, sortDir]);

  function persist(next) {
    setChannels(next);
    saveChannels(next);
  }

  function onAdd(e) {
    e.preventDefault();
    const login = normalizeLogin(newLogin);
    if (!login) return;

    if (channels.some((c) => c.login === login || c.id === login)) {
      setStatus('Channel already exists');
      return;
    }

    const nextColorHex = pickDefaultChannelColorHex(channels, login);
    const next = [...channels, makeNewChannel({ login, colorHex: nextColorHex })].map((c, i) => ({ ...c, sortOrder: i }));
    persist(next);
    setNewLogin('');
    setStatus('');
  }

  async function searchGames() {
    const q = String(gameQuery || '').trim();
    if (!q) {
      setGameOptions([]);
      return;
    }
    setDiscoverStatus('');
    try {
      const json = await apiGet('/search/categories', { query: q, first: 10 });
      const data = Array.isArray(json?.data) ? json.data : [];
      const opts = data
        .map((x) => ({
          id: String(x?.id || ''),
          name: String(x?.name || ''),
          boxArtUrl: String(x?.box_art_url || ''),
        }))
        .filter((x) => x.id && x.name);
      setGameOptions(opts);
    } catch (e) {
      setDiscoverStatus(e instanceof Error ? e.message : 'Failed to search games');
      setGameOptions([]);
    }
  }

  async function discoverChannelsFromVods() {
    setDiscoverStatus('');

    if (!auth?.authed) {
      setDiscoverStatus('Not authenticated. Go to Twitch Login first.');
      return;
    }

    const gameId = String(selectedGame?.id || '').trim();
    if (!gameId) {
      setDiscoverStatus('Pick a game first');
      return;
    }

    const startMs = startAt ? new Date(startAt).getTime() : NaN;
    const endMs = endAt ? new Date(endAt).getTime() : NaN;

    const endStartMs = endStartAt ? new Date(endStartAt).getTime() : NaN;
    const endEndMs = endEndAt ? new Date(endEndAt).getTime() : NaN;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setDiscoverStatus('Provide a valid start and end time');
      return;
    }
    if (endMs < startMs) {
      setDiscoverStatus('End time must be after start time');
      return;
    }

    if ((endStartAt || endEndAt) && (!Number.isFinite(endStartMs) || !Number.isFinite(endEndMs))) {
      setDiscoverStatus('Provide a valid VOD end-time start and end (or leave both blank)');
      return;
    }
    if (Number.isFinite(endStartMs) && Number.isFinite(endEndMs) && endEndMs < endStartMs) {
      setDiscoverStatus('VOD end-time end must be after VOD end-time start');
      return;
    }

    const cacheKey = JSON.stringify({
      gameId,
      startMs,
      endMs,
      endStartMs: Number.isFinite(endStartMs) ? endStartMs : null,
      endEndMs: Number.isFinite(endEndMs) ? endEndMs : null,
      language: selectedLanguage?.id === 'any' ? null : String(selectedLanguage?.id || '').trim() || null,
      type: String(selectedVideoType?.id || '').trim() || null,
    });
    const cached = loadDiscoveryCache(cacheKey);
    if (cached && typeof cached === 'object' && Array.isArray(cached.vods)) {
      setDiscoverVods(cached.vods);
      setDiscoverStatus('Loaded cached VODs');
      return;
    }
    if (cached && Array.isArray(cached)) {
      setDiscoverResults(cached);
      setDiscoverVods([]);
      setDiscoverStatus('Loaded cached results');
      return;
    }

    setDiscoverLoading(true);
    try {
      const fetchedVods = [];
      let cursor = null;
      let reachedPastStart = false;

      for (let page = 0; page < 5; page += 1) {
        const json = await apiGet('/videos', {
          game_id: gameId,
          first: 100,
          ...(selectedVideoType?.id ? { type: selectedVideoType.id } : {}),
          ...(selectedLanguage?.id && selectedLanguage.id !== 'any' ? { language: selectedLanguage.id } : {}),
          sort: 'time',
          ...(cursor ? { after: cursor } : {}),
        });

        const vids = Array.isArray(json?.data) ? json.data : [];
        if (vids.length === 0) break;

        for (const v of vids) {
          const createdAtIso = String(v?.created_at || v?.published_at || '').trim();
          const createdAtMs = createdAtIso ? new Date(createdAtIso).getTime() : NaN;
          if (!Number.isFinite(createdAtMs)) continue;

          const durationMs = parseTwitchDurationToMs(v?.duration);
          const endAtMs = createdAtMs + durationMs;

          if (createdAtMs < startMs) {
            reachedPastStart = true;
            break;
          }
          if (createdAtMs > endMs) {
            continue;
          }

          if (Number.isFinite(endStartMs) && Number.isFinite(endEndMs)) {
            if (endAtMs < endStartMs || endAtMs > endEndMs) continue;
          }

          const userId = String(v?.user_id || '').trim();
          const login = normalizeLogin(v?.user_login);
          const displayName = String(v?.user_name || '').trim();
          const viewCount = asFiniteNumber(v?.view_count, 0);
          if (!userId || !login) continue;

          fetchedVods.push({
            userId,
            userLogin: login,
            userName: displayName || login,
            createdAtMs,
            endAtMs,
            viewCount,
            url: String(v?.url || '').trim() || null,
            title: String(v?.title || '').trim() || null,
          });
        }

        if (reachedPastStart) break;

        cursor = String(json?.pagination?.cursor || '').trim() || null;
        if (!cursor) break;
      }

      setDiscoverVods(fetchedVods);
      saveDiscoveryCache(cacheKey, { vods: fetchedVods });
      setDiscoverStatus(`Fetched ${fetchedVods.length} VOD(s)`);
    } catch (e) {
      setDiscoverStatus(e instanceof Error ? e.message : 'Discovery failed');
    } finally {
      setDiscoverLoading(false);
    }
  }

  function addDiscoveredChannel(row) {
    const login = normalizeLogin(row?.login);
    const broadcasterId = String(row?.userId || '').trim();
    const displayName = String(row?.displayName || '').trim();
    if (!login) return;

    if (channels.some((c) => c.login === login || c.id === login || (broadcasterId && c.broadcasterId === broadcasterId))) {
      setStatus('Channel already exists');
      return;
    }

    const seed = broadcasterId || login;
    const nextColorHex = pickDefaultChannelColorHex(channels, seed);
    const next = [...channels, makeNewChannel({ login, displayName, broadcasterId, colorHex: nextColorHex })].map((c, i) => ({ ...c, sortOrder: i }));
    persist(next);
    setStatus(`Added ${displayName || login}`);
  }

  function addVisibleDiscoveredChannels() {
    const toAdd = visibleDiscoverResults.filter((r) => {
      if (!r) return false;
      const login = normalizeLogin(r.login);
      const broadcasterId = String(r.userId || '').trim();
      return !channels.some((c) => c.login === login || c.id === login || (broadcasterId && c.broadcasterId === broadcasterId));
    });

    if (toAdd.length === 0) {
      setStatus('No new channels to add (based on current filters)');
      return;
    }

    const appended = toAdd.map((r) => {
      const login = normalizeLogin(r.login);
      const broadcasterId = String(r.userId || '').trim();
      const displayName = String(r.displayName || '').trim();
      const seed = broadcasterId || login;
      const nextColorHex = pickDefaultChannelColorHex(channels, seed);
      return makeNewChannel({ login, displayName, broadcasterId, colorHex: nextColorHex });
    });
    const next = [...channels, ...appended].map((c, i) => ({ ...c, sortOrder: i }));
    persist(next);
    setStatus(`Added ${appended.length} channel(s) from visible results`);
  }

  function toggleSort(nextKey) {
    if (sortBy === nextKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(nextKey);
    setSortDir('desc');
  }

  function onReauth() {
    clearToken();
    window.location.assign(toPath('/twitch/login/'));
  }

  function onSelectGame(g) {
    if (!g || !g.id) return;
    const next = { id: String(g.id), name: String(g.name || ''), boxArtUrl: String(g.boxArtUrl || '') };
    setSelectedGame(next);
    setRecentGames((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const deduped = [next, ...base.filter((x) => String(x?.id || '') !== next.id)];
      return deduped.slice(0, 12);
    });
  }

  function onSelectVideoType(t) {
    if (!t || !t.id) return;
    const next = { id: String(t.id), name: String(t.name || '') };
    setSelectedVideoType(next);
    setRecentVideoTypes((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const deduped = [next, ...base.filter((x) => String(x?.id || '') !== next.id)];
      return deduped.slice(0, 12);
    });
  }

  function onSelectLanguage(l) {
    if (!l || !l.id) return;
    const next = { id: String(l.id), name: String(l.name || '') };
    setSelectedLanguage(next);
    setRecentLanguages((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const deduped = [next, ...base.filter((x) => String(x?.id || '') !== next.id)];
      return deduped.slice(0, 12);
    });
  }

  useEffect(() => {
    if (activePicker !== 'game') return;
    if (!auth?.authed) return;
    const q = String(gameQuery || '').trim();
    if (q.length < 2) {
      setGameOptions([]);
      return;
    }
    let t = null;
    t = setTimeout(() => {
      searchGames();
    }, 250);
    return () => {
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePicker, gameQuery, auth?.authed]);

  function move(channelId, dir) {
    const idx = channels.findIndex((c) => c.id === channelId);
    if (idx < 0) return;

    const otherIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= channels.length) return;

    const next = [...channels];
    const tmp = next[idx];
    next[idx] = next[otherIdx];
    next[otherIdx] = tmp;

    persist(next.map((c, i) => ({ ...c, sortOrder: i })));
  }

  function toggleEnabled(channelId) {
    persist(channels.map((c) => (c.id === channelId ? { ...c, isEnabled: !c.isEnabled } : c)));
  }

  function updateColor(channelId, colorHex) {
    const v = String(colorHex || '').trim().toLowerCase();
    const nextHex = v.match(/^#[0-9a-f]{6}$/) ? v : null;
    persist(channels.map((c) => (c.id === channelId ? { ...c, colorHex: nextHex } : c)));
  }

  function updateTimeZone(channelId, timeZone) {
    const tz = String(timeZone || '').trim();
    persist(channels.map((c) => (c.id === channelId ? { ...c, timeZone: tz || null } : c)));
  }

  function updateDisplayName(channelId, displayName) {
    const dn = String(displayName || '').trim();
    persist(channels.map((c) => (c.id === channelId ? { ...c, displayName: dn || c.login } : c)));
  }

  function remove(channelId) {
    const next = channels.filter((c) => c.id !== channelId).map((c, i) => ({ ...c, sortOrder: i }));
    persist(next);
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setStatus('Export copied to clipboard');
    } catch {
      setStatus('Could not copy (clipboard blocked)');
    }
  }

  function onImport() {
    const res = importChannelsJson(importText);
    if (!res.ok) {
      setStatus(`Import failed: ${res.error}`);
      return;
    }

    persist(res.channels);
    setStatus(`Imported ${res.channels.length} channel(s)`);
  }

  function onReset() {
    persist([]);
    setStatus('Cleared channel list');
  }

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="4">Channels</Heading>
          <Text size="2" color="gray">
            Static mode channel config stored in localStorage.
          </Text>
          <Text size="2" color="gray">
            Twitch auth: {auth?.ready ? (auth.authed ? `signed in as ${auth.user?.display_name || auth.user?.login || 'user'}` : 'not signed in') : 'loading'}
          </Text>
          <Text size="2" color="gray">
            Total: {channels.length} | Enabled: {enabledCount}
          </Text>
          {status ? (
            <Text size="2" color="gray">
              {status}
            </Text>
          ) : null}
          <Flex gap="2" wrap="wrap">
            <Button type="button" variant="soft" onClick={onReauth}>
              Re-auth Twitch
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading size="3">Discover channels from VODs</Heading>
          <Text size="2" color="gray">
            Global discovery using Helix Videos by game and filters.
          </Text>

          <Flex direction="column" gap="2">
            <Flex gap="3" wrap="wrap" align="end">
              <CompactChipPicker
                label="Game"
                placeholder="Select game"
                valueLabel={selectedGame?.name || ''}
                isOpen={activePicker === 'game'}
                onOpen={() => setActivePicker('game')}
                onClose={() => setActivePicker(null)}
                query={gameQuery}
                setQuery={setGameQuery}
                options={gameOptions}
                onSelect={(g) => {
                  onSelectGame(g);
                  setActivePicker(null);
                }}
                recents={recentGames}
              />

              <CompactChipPicker
                label="Video type"
                placeholder="Select type"
                valueLabel={selectedVideoType?.name || ''}
                isOpen={activePicker === 'type'}
                onOpen={() => setActivePicker('type')}
                onClose={() => setActivePicker(null)}
                query={videoTypeQuery}
                setQuery={setVideoTypeQuery}
                options={VIDEO_TYPE_OPTIONS.filter((t) => {
                  const q = String(videoTypeQuery || '').trim().toLowerCase();
                  if (!q) return true;
                  return String(t.name || '').toLowerCase().includes(q) || String(t.id || '').toLowerCase().includes(q);
                })}
                onSelect={(t) => {
                  onSelectVideoType(t);
                  setActivePicker(null);
                }}
                recents={recentVideoTypes}
              />

              <CompactChipPicker
                label="Language"
                placeholder="Select language"
                valueLabel={selectedLanguage?.name || ''}
                isOpen={activePicker === 'language'}
                onOpen={() => setActivePicker('language')}
                onClose={() => setActivePicker(null)}
                query={languageQuery}
                setQuery={setLanguageQuery}
                options={LANGUAGE_OPTIONS.filter((l) => {
                  const q = String(languageQuery || '').trim().toLowerCase();
                  if (!q) return true;
                  return String(l.name || '').toLowerCase().includes(q) || String(l.id || '').toLowerCase().includes(q);
                })}
                onSelect={(l) => {
                  onSelectLanguage(l);
                  setActivePicker(null);
                }}
                recents={recentLanguages}
              />
            </Flex>
          </Flex>

          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Start time
              </Text>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                style={{
                  width: 240,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                End time
              </Text>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                style={{
                  width: 240,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <Button type="button" onClick={discoverChannelsFromVods} disabled={!auth?.authed || discoverLoading}>
              {discoverLoading ? 'Discovering…' : 'Discover'}
            </Button>
          </Flex>

          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                VOD end time (optional)
              </Text>
              <Flex gap="2" wrap="wrap">
                <input
                  type="datetime-local"
                  value={endStartAt}
                  onChange={(e) => setEndStartAt(e.target.value)}
                  placeholder="End start"
                  style={{
                    width: 240,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'inherit',
                  }}
                />
                <input
                  type="datetime-local"
                  value={endEndAt}
                  onChange={(e) => setEndEndAt(e.target.value)}
                  placeholder="End end"
                  style={{
                    width: 240,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'inherit',
                  }}
                />
              </Flex>
            </label>
          </Flex>

          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input type="checkbox" checked={startTodEnabled} onChange={(e) => setStartTodEnabled(e.target.checked)} />
              <Text size="2" color="gray">
                VOD start time-of-day
              </Text>
            </label>

            <Flex direction="column" gap="1" style={{ minWidth: 320 }}>
              <Text size="2" color="gray">
                Time zone
              </Text>
              <TimeZonePicker
                variant="chip"
                initialTimeZone={startTodTimeZone || 'UTC'}
                recentsStorageKey="t24_recent_time_zones_v1"
                label="Time zone"
                placeholder="Type to filter…"
                onChange={(tz) => setStartTodTimeZone(tz)}
              />
            </Flex>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Start (HH:MM)
              </Text>
              <input
                type="time"
                value={startTodFrom}
                onChange={(e) => setStartTodFrom(e.target.value)}
                style={{
                  width: 140,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                End (HH:MM)
              </Text>
              <input
                type="time"
                value={startTodTo}
                onChange={(e) => setStartTodTo(e.target.value)}
                style={{
                  width: 140,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>
          </Flex>

          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input type="checkbox" checked={endTodEnabled} onChange={(e) => setEndTodEnabled(e.target.checked)} />
              <Text size="2" color="gray">
                VOD end time-of-day
              </Text>
            </label>

            <Flex direction="column" gap="1" style={{ minWidth: 320 }}>
              <Text size="2" color="gray">
                Time zone
              </Text>
              <TimeZonePicker
                variant="chip"
                initialTimeZone={endTodTimeZone || 'UTC'}
                recentsStorageKey="t24_recent_time_zones_v1"
                label="Time zone"
                placeholder="Type to filter…"
                onChange={(tz) => setEndTodTimeZone(tz)}
              />
            </Flex>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Start (HH:MM)
              </Text>
              <input
                type="time"
                value={endTodFrom}
                onChange={(e) => setEndTodFrom(e.target.value)}
                style={{
                  width: 140,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                End (HH:MM)
              </Text>
              <input
                type="time"
                value={endTodTo}
                onChange={(e) => setEndTodTo(e.target.value)}
                style={{
                  width: 140,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>
          </Flex>

          <Flex gap="3" wrap="wrap" align="end">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Min VOD views
              </Text>
              <input
                inputMode="numeric"
                value={minViewCount}
                onChange={(e) => setMinViewCount(e.target.value)}
                placeholder="1000"
                style={{
                  width: 180,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input type="checkbox" checked={hideExisting} onChange={(e) => setHideExisting(e.target.checked)} />
              <Text size="2" color="gray">
                Hide already-added
              </Text>
            </label>

            <Button type="button" variant="soft" onClick={addVisibleDiscoveredChannels} disabled={!visibleDiscoverResults.length}>
              Add visible ({visibleDiscoverResults.length})
            </Button>
          </Flex>

          {discoverStatus ? (
            <Text size="2" color="gray">
              {discoverStatus}
            </Text>
          ) : null}

          {discoverResults.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 6px', cursor: 'pointer' }} onClick={() => toggleSort('channel')}>
                      Channel
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', cursor: 'pointer' }} onClick={() => toggleSort('latestVodAtMs')}>
                      Latest VOD start
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', cursor: 'pointer' }} onClick={() => toggleSort('latestVodEndAtMs')}>
                      Latest VOD end
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', cursor: 'pointer' }} onClick={() => toggleSort('maxViewCount')}>
                      Max views
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', cursor: 'pointer' }} onClick={() => toggleSort('vodCount')}>
                      VODs matched
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Example</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDiscoverResults.map((r) => {
                    const exists = channels.some((c) => c.login === r.login || (c.broadcasterId && c.broadcasterId === r.userId));
                    return (
                      <tr key={r.userId}>
                        <td style={{ padding: '8px 6px' }}>
                          <Text size="2">
                            {r.displayName} ({r.login})
                          </Text>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <Text size="2" color="gray">
                            {r.latestVodAtMs ? new Date(r.latestVodAtMs).toISOString() : '-'}
                          </Text>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <Text size="2" color="gray">
                            {r.latestVodEndAtMs ? new Date(r.latestVodEndAtMs).toISOString() : '-'}
                          </Text>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <Text size="2" color="gray">
                            {asFiniteNumber(r.maxViewCount, 0).toLocaleString()}
                          </Text>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <Text size="2" color="gray">
                            {r.vodCount}
                          </Text>
                        </td>
                        <td style={{ padding: '8px 6px', maxWidth: 420 }}>
                          {r.sampleVodUrl ? (
                            <a href={r.sampleVodUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                              <Text size="2" color="gray" style={{ overflowWrap: 'anywhere' }}>
                                {r.sampleVodTitle || r.sampleVodUrl}
                              </Text>
                            </a>
                          ) : (
                            <Text size="2" color="gray">
                              -
                            </Text>
                          )}
                        </td>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          <Button type="button" onClick={() => addDiscoveredChannel(r)} disabled={exists}>
                            {exists ? 'Added' : 'Add'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading size="3">Add channel</Heading>
          <form onSubmit={onAdd}>
            <Flex gap="2" align="end" wrap="wrap">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Text size="2" color="gray">
                  Twitch login
                </Text>
                <input
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                  placeholder="e.g. shroud"
                  style={{
                    width: 280,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'inherit',
                  }}
                />
              </label>
              <Button type="submit">Add</Button>
              <Button type="button" variant="soft" color="red" onClick={onReset}>
                Clear all
              </Button>
            </Flex>
          </form>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading size="3">Edit channels</Heading>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Order</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Enabled</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Login</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Color</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Time zone</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c, idx) => (
                  <tr key={c.id}>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      <Flex gap="2" align="center">
                        <Text size="2" color="gray">
                          {idx + 1}
                        </Text>
                        <Button type="button" variant="soft" disabled={idx === 0} onClick={() => move(c.id, 'up')}>
                          Up
                        </Button>
                        <Button
                          type="button"
                          variant="soft"
                          disabled={idx === channels.length - 1}
                          onClick={() => move(c.id, 'down')}
                        >
                          Down
                        </Button>
                      </Flex>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <Button type="button" variant={c.isEnabled ? 'solid' : 'soft'} onClick={() => toggleEnabled(c.id)}>
                        {c.isEnabled ? 'On' : 'Off'}
                      </Button>
                    </td>
                    <td style={{ padding: '8px 6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                      {c.login || c.id}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <input
                        value={c.displayName || ''}
                        onChange={(e) => updateDisplayName(c.id, e.target.value)}
                        style={{
                          width: 200,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.06)',
                          color: 'inherit',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <input
                        type="color"
                        value={c.colorHex || '#94a3b8'}
                        onChange={(e) => updateColor(c.id, e.target.value)}
                        style={{ width: 48, height: 34, padding: 0, border: 'none', background: 'transparent' }}
                      />
                      <Text size="1" color="gray" style={{ marginLeft: 8 }}>
                        {c.colorHex || '-'}
                      </Text>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <input
                        value={c.timeZone || ''}
                        onChange={(e) => updateTimeZone(c.id, e.target.value)}
                        placeholder="e.g. America/Los_Angeles"
                        style={{
                          width: 220,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.06)',
                          color: 'inherit',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      <Button type="button" variant="soft" color="red" onClick={() => remove(c.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {channels.length === 0 ? (
                  <tr>
                    <td style={{ padding: '8px 6px' }} colSpan={7}>
                      <Text size="2" color="gray">
                        No channels yet.
                      </Text>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading size="3">Import / export</Heading>

          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              Export JSON
            </Text>
            <textarea
              value={exportText}
              readOnly
              rows={10}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: 'inherit',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
            />
            <Flex gap="2" wrap="wrap">
              <Button type="button" variant="soft" onClick={copyExport}>
                Copy export
              </Button>
            </Flex>
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              Import JSON
            </Text>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder='Paste JSON array like [{"login":"shroud"}] or object like {"channels": [...]}'
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: 'inherit',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
            />
            <Flex gap="2" wrap="wrap">
              <Button type="button" onClick={onImport}>
                Import
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
