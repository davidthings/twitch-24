import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user?.role !== 'admin') {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const channelId = String(body?.channelId || '');
  const direction = String(body?.direction || '');
  if (!channelId || (direction !== 'up' && direction !== 'down')) {
    return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }

  const channels = await prisma.twitchChannel.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, sortOrder: true },
  });

  const idx = channels.findIndex((c) => c.id === channelId);
  if (idx < 0) {
    return Response.json({ ok: false, error: 'Channel not found' }, { status: 404 });
  }

  if (direction === 'up' && idx === 0) {
    return Response.json({ ok: true, moved: false });
  }
  if (direction === 'down' && idx === channels.length - 1) {
    return Response.json({ ok: true, moved: false });
  }

  const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
  const a = channels[idx];
  const b = channels[otherIdx];
  if (!a || !b) {
    return Response.json({ ok: true, moved: false });
  }

  await prisma.$transaction([
    prisma.twitchChannel.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
    prisma.twitchChannel.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
  ]);

  return Response.json({ ok: true, moved: true });
}
