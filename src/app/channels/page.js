'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { exportChannelsJson, importChannelsJson, loadChannels, saveChannels } from '@/lib/staticChannels';

function normalizeLogin(s) {
  return String(s || '').trim().toLowerCase();
}

function makeNewChannel({ login }) {
  const l = normalizeLogin(login);
  return {
    id: l || `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    login: l,
    displayName: l,
    colorHex: null,
    timeZone: null,
    isEnabled: true,
    sortOrder: 0,
  };
}

export default function StaticChannelsPage() {
  const [channels, setChannels] = useState([]);
  const [status, setStatus] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const initial = loadChannels();
    setChannels(initial);
    setExportText(exportChannelsJson(initial));
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
            Total: {channels.length} | Enabled: {enabledCount}
          </Text>
          {status ? (
            <Text size="2" color="gray">
              {status}
            </Text>
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
