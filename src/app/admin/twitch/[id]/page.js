import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { formatInTimeZone } from '@/lib/datetime';
import { prisma } from '@/lib/prisma';

import TimeZonePicker from '@/app/app/settings/TimeZonePicker';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user?.role !== 'admin') redirect('/app');
  return session;
}

export default async function AdminTwitchChannelPage({ params }) {
  const session = await requireAdmin();
  const viewerTz = session.user?.timeZone || 'UTC';

  const channelId = String(params?.id || '');
  if (!channelId) redirect('/admin/twitch');

  const channel = await prisma.twitchChannel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      login: true,
      broadcasterId: true,
      displayName: true,
      timeZone: true,
      isEnabled: true,
      pollSchedule: true,
      pollStreams: true,
      lastScheduleSyncAt: true,
      lastStreamSyncAt: true,
      scheduleSegments: {
        orderBy: [{ startTime: 'asc' }],
        take: 30,
        where: { startTime: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: {
          id: true,
          twitchId: true,
          title: true,
          startTime: true,
          endTime: true,
          isCanceled: true,
        },
      },
    },
  });

  if (!channel) redirect('/admin/twitch');

  async function setChannelTimeZone(formData) {
    'use server';

    await requireAdmin();

    const tzRaw = formData.get('timeZone');
    const timeZone = String(tzRaw || '').trim();
    if (!timeZone) return;

    await prisma.twitchChannel.update({
      where: { id: channelId },
      data: { timeZone },
    });

    redirect(`/admin/twitch/${channelId}`);
  }

  async function clearChannelTimeZone() {
    'use server';

    await requireAdmin();

    await prisma.twitchChannel.update({
      where: { id: channelId },
      data: { timeZone: null },
    });

    redirect(`/admin/twitch/${channelId}`);
  }

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Heading size="3">Twitch Channel</Heading>
        <Text size="2" color="gray">
          {channel.displayName || channel.login} ({channel.login})
        </Text>
        <Text size="2" color="gray">
          Broadcaster ID: {channel.broadcasterId}
        </Text>
        <Text size="2">
          <Link href="/admin/twitch">Back to Twitch admin</Link>
        </Text>
      </Flex>

      <Flex direction="column" gap="3">
        <Heading size="3">Channel local time zone</Heading>
        <Text size="2" color="gray">
          This is optional. If set, schedule views can show times in the channel’s local time.
        </Text>

        <Flex gap="2" align="center" wrap="wrap">
          <Text size="2" color="gray">
            Current:
          </Text>
          <Text size="2" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
            {channel.timeZone || '-'}
          </Text>
          <form action={clearChannelTimeZone}>
            <Button variant="soft" type="submit" disabled={!channel.timeZone}>
              Clear
            </Button>
          </form>
        </Flex>

        <form action={setChannelTimeZone}>
          <Flex gap="2" align="end" wrap="wrap">
            <TimeZonePicker
              initialTimeZone={channel.timeZone || viewerTz}
              fieldName="timeZone"
              recentsStorageKey={`t24_recent_channel_time_zones_v1`}
            />
            <Button type="submit">Save</Button>
          </Flex>
        </form>
      </Flex>

      <Flex direction="column" gap="3">
        <Heading size="3">Recent schedule segments</Heading>
        <Text size="2" color="gray">
          Displayed in your timezone ({viewerTz}).
        </Text>

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
              {channel.scheduleSegments.map((s) => (
                <tr key={s.id}>
                  <td style={{ padding: '8px 6px' }}>{formatInTimeZone(s.startTime, viewerTz)}</td>
                  <td style={{ padding: '8px 6px' }}>{formatInTimeZone(s.endTime, viewerTz)}</td>
                  <td style={{ padding: '8px 6px' }}>{s.title || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{s.isCanceled ? 'yes' : 'no'}</td>
                </tr>
              ))}
              {channel.scheduleSegments.length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={4}>
                    <Text color="gray" size="2">
                      No schedule segments saved yet. Try polling.
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
