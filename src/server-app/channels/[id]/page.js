import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Flex, Heading, Link, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import ScheduleClient from './ScheduleClient';

export default async function ChannelDetailPage({ params }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const id = String(params?.id || '');
  if (!id) redirect('/app/channels');

  const channel = await prisma.twitchChannel.findUnique({
    where: { id },
    select: {
      id: true,
      login: true,
      displayName: true,
      timeZone: true,
      videos: {
        orderBy: [{ startedAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          twitchId: true,
          title: true,
          url: true,
          startedAt: true,
          endedAt: true,
          durationSeconds: true,
          viewCount: true,
        },
      },
      scheduleSegments: {
        orderBy: [{ startTime: 'asc' }],
        take: 60,
        where: { startTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          isCanceled: true,
        },
      },
    },
  });

  if (!channel) redirect('/app/channels');

  const segments = channel.scheduleSegments.map((s) => ({
    id: s.id,
    title: s.title,
    isCanceled: s.isCanceled,
    startTimeIso: s.startTime.toISOString(),
    endTimeIso: s.endTime.toISOString(),
  }));

  const videos = channel.videos.map((v) => ({
    id: v.id,
    title: v.title,
    url: v.url,
    viewCount: v.viewCount,
    startedAtIso: v.startedAt ? v.startedAt.toISOString() : null,
    endedAtIso: v.endedAt ? v.endedAt.toISOString() : null,
  }));

  const userTimeZone = session.user?.timeZone || 'UTC';

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Heading size="4">{channel.displayName || channel.login}</Heading>
        <Text size="2" color="gray">
          Channel: {channel.login}
        </Text>
        <Text size="2">
          <Link href="/app/channels">Back to channels</Link>
        </Text>
      </Flex>

      <ScheduleClient
        channelLabel={channel.login}
        channelTimeZone={channel.timeZone || null}
        userTimeZone={userTimeZone}
        segments={segments}
        videos={videos}
      />

      <Text size="2" color="gray">
        Channel timezone: {channel.timeZone || '-'}
      </Text>
    </Flex>
  );
}
