'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { exportChannelsJson, importChannelsJson, loadChannels, saveChannels } from '@/lib/staticChannels';
import { apiGet } from '@/lib/twitchAuth/helix';
import { toPath } from '@/lib/twitchAuth/oauth';
import { clearToken } from '@/lib/twitchAuth/tokenStorage';
import { useTwitchAuth } from '@/lib/twitchAuth/useTwitchAuth';

function normalizeLogin(s) {
  return String(s || '').trim().toLowerCase();
}

function makeNewChannel({ login, displayName, broadcasterId }) {
  const l = normalizeLogin(login);
  return {
    id: l || `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    login: l,
    displayName: String(displayName || '').trim() || l,
    broadcasterId: String(broadcasterId || '').trim() || null,
    colorHex: null,
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

const DISCOVERY_CACHE_KEY = 't24_channel_discovery_cache_v1';

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
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [discoverStatus, setDiscoverStatus] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverResults, setDiscoverResults] = useState([]);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const initial = loadChannels();
    setChannels(initial);
    setExportText(exportChannelsJson(initial));

    const now = Date.now();
    setEndAt(formatDateTimeLocalValue(now));
    setStartAt(formatDateTimeLocalValue(now - 7 * 24 * 60 * 60 * 1000));
  }, []);

  useEffect(() => {
    setExportText(exportChannelsJson(channels));
  }, [channels]);

  const enabledCount = useMemo(() => channels.filter((c) => c.isEnabled).length, [channels]);

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

    const next = [...channels, makeNewChannel({ login })].map((c, i) => ({ ...c, sortOrder: i }));
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

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setDiscoverStatus('Provide a valid start and end time');
      return;
    }
    if (endMs < startMs) {
      setDiscoverStatus('End time must be after start time');
      return;
    }

    const cacheKey = JSON.stringify({ gameId, startMs, endMs, language: 'en', type: 'archive' });
    const cached = loadDiscoveryCache(cacheKey);
    if (cached && Array.isArray(cached)) {
      setDiscoverResults(cached);
      setDiscoverStatus('Loaded cached results');
      return;
    }

    setDiscoverLoading(true);
    try {
      const channelByUserId = new Map();
      let cursor = null;
      let reachedPastStart = false;

      for (let page = 0; page < 5; page += 1) {
        const json = await apiGet('/videos', {
          game_id: gameId,
          first: 100,
          type: 'archive',
          language: 'en',
          sort: 'time',
          ...(cursor ? { after: cursor } : {}),
        });

        const vids = Array.isArray(json?.data) ? json.data : [];
        if (vids.length === 0) break;

        for (const v of vids) {
          const createdAtIso = String(v?.created_at || v?.published_at || '').trim();
          const createdAtMs = createdAtIso ? new Date(createdAtIso).getTime() : NaN;
          if (!Number.isFinite(createdAtMs)) continue;

          if (createdAtMs < startMs) {
            reachedPastStart = true;
            break;
          }
          if (createdAtMs > endMs) {
            continue;
          }

          const userId = String(v?.user_id || '').trim();
          const login = normalizeLogin(v?.user_login);
          const displayName = String(v?.user_name || '').trim();
          if (!userId || !login) continue;

          const prev = channelByUserId.get(userId) || {
            userId,
            login,
            displayName: displayName || login,
            latestVodAtMs: createdAtMs,
            vodCount: 0,
            sampleVodUrl: String(v?.url || '').trim() || null,
            sampleVodTitle: String(v?.title || '').trim() || null,
          };

          prev.vodCount += 1;
          prev.latestVodAtMs = Math.max(prev.latestVodAtMs || 0, createdAtMs);
          if (!prev.sampleVodUrl) prev.sampleVodUrl = String(v?.url || '').trim() || null;
          if (!prev.sampleVodTitle) prev.sampleVodTitle = String(v?.title || '').trim() || null;
          if (!prev.displayName || prev.displayName === prev.login) {
            prev.displayName = displayName || prev.login;
          }

          channelByUserId.set(userId, prev);
        }

        if (reachedPastStart) break;

        cursor = String(json?.pagination?.cursor || '').trim() || null;
        if (!cursor) break;
      }

      const results = Array.from(channelByUserId.values())
        .sort((a, b) => (b.latestVodAtMs || 0) - (a.latestVodAtMs || 0))
        .slice(0, 200);

      setDiscoverResults(results);
      saveDiscoveryCache(cacheKey, results);
      setDiscoverStatus(`Found ${results.length} channel(s)`);
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

    const next = [...channels, makeNewChannel({ login, displayName, broadcasterId })].map((c, i) => ({ ...c, sortOrder: i }));
    persist(next);
    setStatus(`Added ${displayName || login}`);
  }

  function onReauth() {
    clearToken();
    window.location.assign(toPath('/twitch/login/'));
  }

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
            Global discovery using Helix Videos by game. Filters: type=VOD (archive), language=en, VOD start time range.
          </Text>

          <Flex direction="column" gap="2">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Game search
              </Text>
              <Flex gap="2" align="end" wrap="wrap">
                <input
                  value={gameQuery}
                  onChange={(e) => setGameQuery(e.target.value)}
                  placeholder="e.g. Fortnite"
                  style={{
                    width: 320,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'inherit',
                  }}
                />
                <Button type="button" variant="soft" onClick={searchGames} disabled={!auth?.authed}>
                  Search games
                </Button>
              </Flex>
            </label>

            {gameOptions.length ? (
              <Flex gap="2" wrap="wrap">
                {gameOptions.map((g) => (
                  <Button
                    key={g.id}
                    type="button"
                    variant={selectedGame?.id === g.id ? 'solid' : 'soft'}
                    onClick={() => setSelectedGame(g)}
                  >
                    {g.name}
                  </Button>
                ))}
              </Flex>
            ) : null}

            <Text size="2" color="gray">
              Selected game: {selectedGame?.name || '—'}
            </Text>
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
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Channel</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Latest VOD</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>VODs matched</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Example</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discoverResults.map((r) => {
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
