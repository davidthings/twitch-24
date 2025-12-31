import { prisma } from '@/lib/prisma';
import { twitchAppFetch } from '@/lib/twitch';

function requireCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return;

  throw new Error('Unauthorized');
}

async function syncScheduleForChannel(channel) {
  let segments = [];
  try {
    const json = await twitchAppFetch('schedule', {
      query: {
        broadcaster_id: channel.broadcasterId,
        first: 25,
      },
    });
    segments = Array.isArray(json?.data?.segments) ? json.data.segments : [];
  } catch (err) {
    const status = err && typeof err === 'object' ? err.status : null;
    if (status !== 404) {
      throw err;
    }
  }

  const segmentIds = new Set();

  for (const seg of segments) {
    const twitchId = seg.id;
    if (!twitchId) continue;

    segmentIds.add(twitchId);

    const startTime = seg.start_time ? new Date(seg.start_time) : null;
    const endTime = seg.end_time ? new Date(seg.end_time) : null;

    if (!startTime || !endTime) continue;

    const title = seg.title ? String(seg.title) : null;
    const isCanceled = Boolean(seg.canceled_until);

    await prisma.twitchScheduleSegment.upsert({
      where: {
        channelId_twitchId: {
          channelId: channel.id,
          twitchId,
        },
      },
      create: {
        channelId: channel.id,
        twitchId,
        title,
        startTime,
        endTime,
        isCanceled,
      },
      update: {
        title,
        startTime,
        endTime,
        isCanceled,
      },
    });
  }

  const pruneBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.twitchScheduleSegment.deleteMany({
    where: {
      channelId: channel.id,
      startTime: { gte: pruneBefore },
      twitchId: { notIn: Array.from(segmentIds) },
    },
  });

  await prisma.twitchChannel.update({
    where: { id: channel.id },
    data: { lastScheduleSyncAt: new Date() },
  });
}

async function syncStreamForChannel(channel) {
  const json = await twitchAppFetch('streams', {
    query: {
      user_id: channel.broadcasterId,
      first: 1,
    },
  });

  const stream = Array.isArray(json?.data) ? json.data[0] : null;

  await prisma.twitchStreamSnapshot.create({
    data: {
      channelId: channel.id,
      isLive: Boolean(stream),
      streamId: stream?.id ? String(stream.id) : null,
      startedAt: stream?.started_at ? new Date(stream.started_at) : null,
      viewerCount: typeof stream?.viewer_count === 'number' ? stream.viewer_count : null,
      title: stream?.title ? String(stream.title) : null,
    },
  });

  await prisma.twitchChannel.update({
    where: { id: channel.id },
    data: { lastStreamSyncAt: new Date() },
  });
}

function parseTwitchDurationToSeconds(duration) {
  const str = String(duration || '');
  if (!str) return null;

  const m = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;

  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  if ([h, min, s].some((n) => Number.isNaN(n))) return null;

  return h * 3600 + min * 60 + s;
}

async function syncVideosForChannel(channel) {
  const json = await twitchAppFetch('videos', {
    query: {
      user_id: channel.broadcasterId,
      first: 50,
      type: 'archive',
      sort: 'time',
    },
  });

  const videos = Array.isArray(json?.data) ? json.data : [];
  const now = new Date();

  for (const v of videos) {
    const twitchId = v?.id ? String(v.id) : '';
    if (!twitchId) continue;

    const streamId = v?.stream_id ? String(v.stream_id) : null;
    const type = v?.type ? String(v.type) : null;
    const title = v?.title ? String(v.title) : null;
    const description = v?.description ? String(v.description) : null;
    const url = v?.url ? String(v.url) : null;
    const thumbnailUrl = v?.thumbnail_url ? String(v.thumbnail_url) : null;
    const viewCount = typeof v?.view_count === 'number' ? v.view_count : null;
    const language = v?.language ? String(v.language) : null;

    const durationSeconds = parseTwitchDurationToSeconds(v?.duration);
    const startedAt = v?.created_at ? new Date(v.created_at) : null;
    const endedAt = startedAt && durationSeconds ? new Date(startedAt.getTime() + durationSeconds * 1000) : null;

    await prisma.twitchVideo.upsert({
      where: { twitchId },
      create: {
        channelId: channel.id,
        twitchId,
        streamId,
        type,
        title,
        description,
        url,
        thumbnailUrl,
        viewCount,
        language,
        durationSeconds,
        startedAt,
        endedAt,
        lastSeenAt: now,
      },
      update: {
        channelId: channel.id,
        streamId,
        type,
        title,
        description,
        url,
        thumbnailUrl,
        viewCount,
        language,
        durationSeconds,
        startedAt,
        endedAt,
        lastSeenAt: now,
      },
    });
  }

  await prisma.twitchChannel.update({
    where: { id: channel.id },
    data: { lastVideoSyncAt: now },
  });
}

export async function GET(req) {
  try {
    requireCronAuth(req);

    const channels = await prisma.twitchChannel.findMany({
      where: { isEnabled: true },
      orderBy: [{ createdAt: 'asc' }],
    });

    const scheduleIntervalMs = 10 * 60 * 1000;
    const videoIntervalMs = 60 * 60 * 1000;

    const results = [];

    for (const channel of channels) {
      const startedAt = Date.now();

      if (channel.pollStreams) {
        await syncStreamForChannel(channel);
      }

      const lastScheduleAtMs = channel.lastScheduleSyncAt ? channel.lastScheduleSyncAt.getTime() : 0;
      const shouldSyncSchedule = channel.pollSchedule && Date.now() - lastScheduleAtMs > scheduleIntervalMs;

      if (shouldSyncSchedule) {
        await syncScheduleForChannel(channel);
      }

      const lastVideoAtMs = channel.lastVideoSyncAt ? channel.lastVideoSyncAt.getTime() : 0;
      const shouldSyncVideos = channel.pollVideos && Date.now() - lastVideoAtMs > videoIntervalMs;

      if (shouldSyncVideos) {
        await syncVideosForChannel(channel);
      }

      results.push({
        channel: channel.login,
        polledStreams: Boolean(channel.pollStreams),
        polledSchedule: Boolean(shouldSyncSchedule),
        polledVideos: Boolean(shouldSyncVideos),
        ms: Date.now() - startedAt,
      });
    }

    return Response.json({ ok: true, channels: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
