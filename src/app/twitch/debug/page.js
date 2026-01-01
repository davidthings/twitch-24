'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

const HELIX_LOG_KEY = 't24_helix_latest_v1';
const CACHE_KEYS = ['t24_channel_discovery_cache_v1', 't24_static_timeline_cache_v1'];

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function readLog() {
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

function summarizeResponse(resp) {
  if (!resp || typeof resp !== 'object') return { kind: 'unknown', count: 0, sample: null };
  if (Array.isArray(resp.data)) return { kind: 'data[]', count: resp.data.length, sample: resp.data.slice(0, 100) };
  if (resp.data && typeof resp.data === 'object') {
    if (Array.isArray(resp.data.segments)) {
      return { kind: 'data.segments[]', count: resp.data.segments.length, sample: resp.data.segments.slice(0, 100) };
    }
  }
  return { kind: 'object', count: 0, sample: null };
}

export default function TwitchDebugPage() {
  const [log, setLog] = useState(null);
  const [selectedPath, setSelectedPath] = useState('');
  const selectedPathRef = useRef('');
  const [cacheStatus, setCacheStatus] = useState('');

  function refresh() {
    const next = readLog();
    setLog(next);

    const byPath = next && next.byPath ? next.byPath : null;
    const paths = byPath ? Object.keys(byPath) : [];
    const current = selectedPathRef.current;
    const hasCurrent = current && paths.includes(current);

    if (!hasCurrent) {
      const first = paths.sort()[0] || '';
      if (first) {
        selectedPathRef.current = first;
        setSelectedPath(first);
      }
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const paths = log && log.byPath ? Object.keys(log.byPath).sort() : [];
  const entry = selectedPath && log && log.byPath ? log.byPath[selectedPath] : null;
  const summary = entry ? summarizeResponse(entry.response) : null;

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="4">Twitch Helix Debug</Heading>
          <Text size="2" color="gray">
            Shows the latest request/response per Helix endpoint (client-side log). Useful for validating filters.
          </Text>
          {cacheStatus ? (
            <Text size="2" color="gray">
              {cacheStatus}
            </Text>
          ) : null}
          <Flex gap="2" wrap="wrap" align="center">
            <Button type="button" variant="soft" onClick={refresh}>
              Refresh
            </Button>
            <Button
              type="button"
              variant="soft"
              color="red"
              onClick={() => {
                let cleared = 0;
                try {
                  for (const k of CACHE_KEYS) {
                    try {
                      const had = window.localStorage.getItem(k) !== null;
                      window.localStorage.removeItem(k);
                      if (had) cleared += 1;
                    } catch {
                    }
                  }
                } catch {
                }
                setCacheStatus(`Cleared ${cleared} cache key(s)`);
              }}
            >
              Clear caches
            </Button>
            <Button
              type="button"
              variant="soft"
              color="red"
              onClick={() => {
                try {
                  window.localStorage.removeItem(HELIX_LOG_KEY);
                } catch {
                }
                setLog(null);
                selectedPathRef.current = '';
                setSelectedPath('');
                setCacheStatus('');
              }}
            >
              Clear log
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Flex gap="4" wrap="wrap" align="start">
        <Card style={{ minWidth: 260, flex: 1 }}>
          <Flex direction="column" gap="2">
            <Heading size="3">Endpoints</Heading>
            {paths.length ? (
              <Flex gap="2" wrap="wrap">
                {paths.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant={p === selectedPath ? 'solid' : 'soft'}
                    onClick={() => {
                      selectedPathRef.current = p;
                      setSelectedPath(p);
                    }}
                  >
                    {p}
                  </Button>
                ))}
              </Flex>
            ) : (
              <Text size="2" color="gray">
                No Helix calls logged yet. Use the app (timeline, channels discovery, etc.) and come back.
              </Text>
            )}
          </Flex>
        </Card>

        <Card style={{ minWidth: 320, flex: 3 }}>
          <Flex direction="column" gap="3">
            <Heading size="3">Latest</Heading>
            {!entry ? (
              <Text size="2" color="gray">
                Select an endpoint.
              </Text>
            ) : (
              <>
                <Flex direction="column" gap="1">
                  <Text size="2" color="gray">
                    Path: {entry.path}
                  </Text>
                  <Text size="2" color="gray">
                    Time: {entry.ts ? new Date(entry.ts).toISOString() : '-'}
                  </Text>
                  <Text size="2" color="gray">
                    OK: {String(entry.ok)} | HTTP: {entry.status ?? '-'} | Duration: {entry.durationMs ?? '-'}ms
                  </Text>
                  <Text size="2" color="gray" style={{ overflowWrap: 'anywhere' }}>
                    URL: {entry.url}
                  </Text>
                  {entry.errorText ? (
                    <Text size="2" color="red" style={{ overflowWrap: 'anywhere' }}>
                      Error: {entry.errorText}
                    </Text>
                  ) : null}
                </Flex>

                {summary ? (
                  <Flex direction="column" gap="1">
                    <Text size="2" color="gray">
                      Response shape: {summary.kind}
                      {summary.count ? ` (${summary.count})` : ''}
                    </Text>
                  </Flex>
                ) : null}

                {summary && summary.sample ? (
                  <Flex direction="column" gap="1">
                    <Heading size="3">First 100 results</Heading>
                    <pre style={{ margin: 0, padding: 12, overflowX: 'auto', background: 'rgba(255,255,255,0.06)', borderRadius: 8 }}>
                      {JSON.stringify(summary.sample, null, 2)}
                    </pre>
                  </Flex>
                ) : null}

                <Flex direction="column" gap="1">
                  <Heading size="3">Full JSON</Heading>
                  <pre style={{ margin: 0, padding: 12, overflowX: 'auto', background: 'rgba(255,255,255,0.06)', borderRadius: 8 }}>
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                </Flex>
              </>
            )}
          </Flex>
        </Card>
      </Flex>
    </Flex>
  );
}
