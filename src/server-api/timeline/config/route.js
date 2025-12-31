import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const clampInt = (n, min, max) => {
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
};

const isValidTimeZone = (tz) => {
  const v = String(tz || '').trim();
  if (!v) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { timelineConfig: true },
  });

  return Response.json({ ok: true, timelineConfig: user?.timelineConfig || null });
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const cfg = body && typeof body === 'object' ? body : {};

  const selectedChannelIds = Array.isArray(cfg.selectedChannelIds)
    ? cfg.selectedChannelIds
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 200)
    : null;

  const pastDays = cfg.pastDays !== undefined ? clampInt(cfg.pastDays, 0, 365) : null;
  const futureDays = cfg.futureDays !== undefined ? clampInt(cfg.futureDays, 0, 365) : null;

  const modeRaw = cfg.displayTimeZoneMode !== undefined ? String(cfg.displayTimeZoneMode) : null;
  const displayTimeZoneMode =
    modeRaw === 'utc' || modeRaw === 'user' || modeRaw === 'channel' || modeRaw === 'custom' ? modeRaw : null;

  const customTimeZoneRaw = cfg.customTimeZone !== undefined ? String(cfg.customTimeZone) : null;
  const customTimeZone = customTimeZoneRaw && isValidTimeZone(customTimeZoneRaw) ? customTimeZoneRaw.trim() : null;

  const timelineConfig = {
    ...(selectedChannelIds ? { selectedChannelIds } : {}),
    ...(pastDays !== null ? { pastDays } : {}),
    ...(futureDays !== null ? { futureDays } : {}),
    ...(displayTimeZoneMode ? { displayTimeZoneMode } : {}),
    ...(customTimeZone ? { customTimeZone } : {}),
  };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { timelineConfig },
  });

  return Response.json({ ok: true, timelineConfig });
}
