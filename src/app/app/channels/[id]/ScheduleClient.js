'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';

import TimeZonePicker from '@/app/app/settings/TimeZonePicker';

function formatInTimeZoneClient(dateIso, timeZone) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '';

  const opts = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  try {
    if (timeZone) {
      return new Intl.DateTimeFormat(undefined, { timeZone, ...opts }).format(d);
    }
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts }).format(d);
  }
}

export default function ScheduleClient({
  channelTimeZone,
  userTimeZone,
  segments,
  videos,
  channelLabel,
}) {
  const [mode, setMode] = useState('user');
  const [customTz, setCustomTz] = useState('UTC');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('t24_schedule_tz_mode_v1');
      const rawTz = localStorage.getItem('t24_schedule_tz_custom_v1');
      if (raw) setMode(raw);
      if (rawTz) setCustomTz(rawTz);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('t24_schedule_tz_mode_v1', mode);
      localStorage.setItem('t24_schedule_tz_custom_v1', customTz);
    } catch {
      // ignore
    }
  }, [mode, customTz]);

  const resolved = useMemo(() => {
    if (mode === 'system') return null;
    if (mode === 'utc') return 'UTC';
    if (mode === 'user') return userTimeZone || 'UTC';
    if (mode === 'channel') return channelTimeZone || userTimeZone || 'UTC';
    if (mode === 'custom') return customTz || 'UTC';
    return userTimeZone || 'UTC';
  }, [mode, userTimeZone, channelTimeZone, customTz]);

  const modeLabel = useMemo(() => {
    if (mode === 'system') return 'System';
    if (mode === 'utc') return 'UTC';
    if (mode === 'user') return `User (${userTimeZone || 'UTC'})`;
    if (mode === 'channel') return `Channel (${channelTimeZone || '-'})`;
    if (mode === 'custom') return `Custom (${customTz || 'UTC'})`;
    return 'User';
  }, [mode, userTimeZone, channelTimeZone, customTz]);

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          Display timezone
        </Text>

        <Flex gap="2" wrap="wrap">
          <Button variant={mode === 'user' ? 'solid' : 'soft'} type="button" onClick={() => setMode('user')}>
            User
          </Button>
          <Button variant={mode === 'utc' ? 'solid' : 'soft'} type="button" onClick={() => setMode('utc')}>
            UTC
          </Button>
          <Button
            variant={mode === 'channel' ? 'solid' : 'soft'}
            type="button"
            onClick={() => setMode('channel')}
            disabled={!channelTimeZone}
          >
            Channel
          </Button>
          <Button variant={mode === 'system' ? 'solid' : 'soft'} type="button" onClick={() => setMode('system')}>
            System
          </Button>
          <Button variant={mode === 'custom' ? 'solid' : 'soft'} type="button" onClick={() => setMode('custom')}>
            Custom
          </Button>
        </Flex>

        <Text size="2" color="gray">
          Using: {modeLabel}
        </Text>

        {mode === 'custom' ? (
          <TimeZonePicker
            initialTimeZone={customTz}
            fieldName="__ignored"
            recentsStorageKey="t24_recent_schedule_custom_time_zones_v1"
            onChange={(tz) => setCustomTz(tz)}
          />
        ) : null}
      </Flex>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Start</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>End</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Title</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Canceled</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={s.id}>
                <td style={{ padding: '8px 6px' }}>{formatInTimeZoneClient(s.startTimeIso, resolved)}</td>
                <td style={{ padding: '8px 6px' }}>{formatInTimeZoneClient(s.endTimeIso, resolved)}</td>
                <td style={{ padding: '8px 6px' }}>{s.title || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{s.isCanceled ? 'yes' : 'no'}</td>
              </tr>
            ))}
            {segments.length === 0 ? (
              <tr>
                <td style={{ padding: '8px 6px' }} colSpan={4}>
                  <Text size="2" color="gray">
                    No schedule segments saved yet for {channelLabel}.
                  </Text>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Flex direction="column" gap="2">
        <Text size="2" color="gray">
          Recent videos
        </Text>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Start</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>End</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Title</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Views</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {(videos || []).map((v) => (
                <tr key={v.id}>
                  <td style={{ padding: '8px 6px' }}>{v.startedAtIso ? formatInTimeZoneClient(v.startedAtIso, resolved) : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{v.endedAtIso ? formatInTimeZoneClient(v.endedAtIso, resolved) : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{v.title || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{typeof v.viewCount === 'number' ? v.viewCount : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{v.url ? <a href={v.url}>Open</a> : '-'}</td>
                </tr>
              ))}
              {(videos || []).length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={5}>
                    <Text size="2" color="gray">
                      No videos saved yet for {channelLabel}.
                    </Text>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Flex>
    </Flex>
  );
}
