'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';

function loadRecents(storageKey) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecents(storageKey, arr) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

function normalizePhrase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\/_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProbablyValidIanaTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export default function TimeZonePicker({
  initialTimeZone = 'UTC',
  fieldName = 'timeZone',
  recentsStorageKey = 't24_recent_time_zones_v1',
  onChange,
}) {
  const [timeZone, setTimeZone] = useState(initialTimeZone || 'UTC');
  const [editing, setEditing] = useState(false);
  const [tzInput, setTzInput] = useState('');
  const [recents, setRecents] = useState([]);
  const [tzList, setTzList] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    setRecents(loadRecents(recentsStorageKey));

    let list = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        list = Intl.supportedValuesOf('timeZone');
      }
    } catch {
      // ignore
    }

    if (!Array.isArray(list) || list.length === 0) {
      list = [
        'UTC',
        'Pacific/Auckland',
        'Australia/Sydney',
        'Asia/Tokyo',
        'Asia/Singapore',
        'Asia/Kolkata',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
      ];
    }

    setTzList(list);
  }, []);

  useEffect(() => {
    setTimeZone(initialTimeZone || 'UTC');
  }, [initialTimeZone]);

  useEffect(() => {
    if (!editing) return;
    setTzInput('');
    const id = setTimeout(() => {
      inputRef.current?.focus?.();
    }, 0);
    return () => clearTimeout(id);
  }, [editing]);

  const tzAliases = useMemo(
    () => ({
      PST: 'America/Los_Angeles',
      PDT: 'America/Los_Angeles',
      MST: 'America/Denver',
      MDT: 'America/Denver',
      CST: 'America/Chicago',
      CDT: 'America/Chicago',
      EST: 'America/New_York',
      EDT: 'America/New_York',
      GMT: 'UTC',
      BST: 'Europe/London',
      CET: 'Europe/Paris',
      CEST: 'Europe/Paris',
      IST: 'Asia/Kolkata',
      JST: 'Asia/Tokyo',
      AEST: 'Australia/Sydney',
      AEDT: 'Australia/Sydney',
      NZST: 'Pacific/Auckland',
      NZDT: 'Pacific/Auckland',
    }),
    [],
  );

  const suggestions = useMemo(() => {
    const qRaw = tzInput.trim();
    if (!qRaw) return [];

    const qUpper = qRaw.toUpperCase();
    const q = normalizePhrase(qRaw);
    const tokens = q.split(' ').filter(Boolean);

    const out = [];
    const seen = new Set();

    const aliasTarget = tzAliases[qUpper];
    if (aliasTarget) {
      out.push(aliasTarget);
      seen.add(aliasTarget);
    }

    for (const tz of tzList) {
      const norm = normalizePhrase(tz);

      let match = norm.includes(q);
      if (!match && tokens.length > 1) {
        match = tokens.every((t) => norm.includes(t));
      }

      if (!match) continue;
      if (seen.has(tz)) continue;

      out.push(tz);
      seen.add(tz);

      if (out.length >= 20) break;
    }

    return out;
  }, [tzInput, tzList, tzAliases]);

  const preview = useMemo(() => {
    const d = new Date();
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d);
    } catch {
      return d.toISOString();
    }
  }, [timeZone]);

  function pushRecent(tz) {
    const next = recents.slice();
    const idx = next.findIndex((x) => x === tz);
    if (idx !== -1) next.splice(idx, 1);
    next.unshift(tz);
    while (next.length > 5) next.pop();
    setRecents(next);
    saveRecents(recentsStorageKey, next);
  }

  function applyTimeZone(nextTz) {
    const val = String(nextTz || '').trim();
    if (!val) return;

    if (!isProbablyValidIanaTimeZone(val)) {
      return;
    }

    setTimeZone(val);
    if (typeof onChange === 'function') onChange(val);
    pushRecent(val);
    setEditing(false);
  }

  function applySystemTimeZone() {
    try {
      const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (sys) applyTimeZone(sys);
    } catch {
      // ignore
    }
  }

  function applyFromInput() {
    const raw = tzInput.trim();
    if (!raw) return;

    const alias = tzAliases[raw.toUpperCase()];
    if (alias) {
      applyTimeZone(alias);
      return;
    }

    if (isProbablyValidIanaTimeZone(raw)) {
      applyTimeZone(raw);
      return;
    }

    if (suggestions.length > 0) {
      applyTimeZone(suggestions[0]);
    }
  }

  return (
    <Flex direction="column" gap="2">
      <input type="hidden" name={fieldName} value={timeZone} />

      {!editing ? (
        <Flex gap="2" align="center" wrap="wrap">
          <Text size="2" color="gray">
            Selected
          </Text>
          <Text size="2" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
            {timeZone}
          </Text>
          <Button variant="soft" type="button" onClick={() => setEditing(true)}>
            Change
          </Button>
          <Text size="2" color="gray">
            {preview}
          </Text>
        </Flex>
      ) : (
        <Flex direction="column" gap="2">
          <Flex gap="2" align="center" wrap="wrap">
            <input
              ref={inputRef}
              value={tzInput}
              onChange={(e) => setTzInput(e.target.value)}
              placeholder="e.g. Europe/Paris, Los Angeles, PST"
              style={{
                width: 360,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: 'inherit',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyFromInput();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />

            <Button variant="soft" type="button" onClick={applyFromInput}>
              Set
            </Button>

            <Button variant="soft" type="button" onClick={() => applyTimeZone('UTC')}>
              UTC
            </Button>

            <Button variant="soft" type="button" onClick={applySystemTimeZone}>
              Use system
            </Button>

            <Button variant="soft" color="gray" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Flex>

          {recents.length > 0 ? (
            <Flex gap="2" wrap="wrap">
              {recents.map((z) => (
                <Button key={z} variant="soft" type="button" onClick={() => applyTimeZone(z)}>
                  {z}
                </Button>
              ))}
            </Flex>
          ) : null}

          {suggestions.length > 0 ? (
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 8,
                padding: 8,
                maxHeight: 220,
                overflow: 'auto',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <Flex gap="2" wrap="wrap">
                {suggestions.map((z) => (
                  <Button key={z} variant="soft" type="button" onClick={() => applyTimeZone(z)}>
                    {z}
                  </Button>
                ))}
              </Flex>
            </div>
          ) : null}
        </Flex>
      )}
    </Flex>
  );
}
