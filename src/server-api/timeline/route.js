import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const dayMs = 24 * 60 * 60 * 1000;

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);

  const originMsRaw = url.searchParams.get('originMs');
  const originMs = originMsRaw ? Number(originMsRaw) : Date.now();

  const pastDaysRaw = url.searchParams.get('pastDays');
  const futureDaysRaw = url.searchParams.get('futureDays');

  const pastDays = pastDaysRaw ? Math.max(0, Math.min(365, Number(pastDaysRaw))) : 10;
  const futureDays = futureDaysRaw ? Math.max(0, Math.min(365, Number(futureDaysRaw))) : 5;

  const hasChannelIds = url.searchParams.has('channelIds');
  const channelIdsRaw = url.searchParams.get('channelIds');
  const channelIds = hasChannelIds
    ? String(channelIdsRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const windowStart = new Date(originMs - pastDays * dayMs);
  const windowEnd = new Date(originMs + futureDays * dayMs);

  const channels = await prisma.twitchChannel.findMany({
    where: {
      isEnabled: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { login: 'asc' }],
    select: {
      id: true,
      login: true,
      displayName: true,
      colorHex: true,
      timeZone: true,
      sortOrder: true,
    },
  });

  const enabledIdSet = new Set(channels.map((c) => c.id));
  const selectedIds = (channelIds === null ? channels.map((c) => c.id) : channelIds).filter((id) => enabledIdSet.has(id));

  const scheduleSegments = selectedIds.length
    ? await prisma.twitchScheduleSegment.findMany({
        where: {
          channelId: { in: selectedIds },
          startTime: { lt: windowEnd },
          endTime: { gt: windowStart },
        },
        orderBy: [{ startTime: 'asc' }],
        take: 2000,
        select: {
          id: true,
          channelId: true,
          title: true,
          startTime: true,
          endTime: true,
          isCanceled: true,
        },
      })
    : [];

  const videos = selectedIds.length
    ? await prisma.twitchVideo.findMany({
        where: {
          channelId: { in: selectedIds },
          startedAt: { not: null, lt: windowEnd, gt: windowStart },
        },
        orderBy: [{ startedAt: 'asc' }],
        take: 2000,
        select: {
          id: true,
          channelId: true,
          title: true,
          url: true,
          startedAt: true,
          endedAt: true,
          viewCount: true,
        },
      })
    : [];

  return Response.json({
    ok: true,
    originMs,
    pastDays,
    futureDays,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    channels,
    selectedChannelIds: selectedIds,
    scheduleSegments: scheduleSegments.map((s) => ({
      id: s.id,
      channelId: s.channelId,
      title: s.title,
      startTimeIso: s.startTime.toISOString(),
      endTimeIso: s.endTime.toISOString(),
      isCanceled: s.isCanceled,
    })),
    videos: videos.map((v) => ({
      id: v.id,
      channelId: v.channelId,
      title: v.title,
      url: v.url,
      startedAtIso: v.startedAt ? v.startedAt.toISOString() : null,
      endedAtIso: v.endedAt ? v.endedAt.toISOString() : null,
      viewCount: v.viewCount,
    })),
  });
}
