import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTwitchUserByLogin } from '@/lib/twitch';

const DEFAULT_CHANNEL_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22c55e', '#38bdf8', '#fb7185', '#f97316', '#94a3b8'];

function hashStringToIndex(str, mod) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return mod ? hash % mod : hash;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user?.role !== 'admin') redirect('/app');
  return session;
}

async function loadData() {
  const channels = await prisma.twitchChannel.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      login: true,
      broadcasterId: true,
      displayName: true,
      colorHex: true,
      sortOrder: true,
      timeZone: true,
    },
  });

  const missingColor = channels.filter((c) => !c.colorHex);
  if (missingColor.length) {
    await prisma.$transaction(
      missingColor.map((c) => {
        const defaultColorHex = DEFAULT_CHANNEL_COLORS[hashStringToIndex(c.broadcasterId || c.login || c.id, DEFAULT_CHANNEL_COLORS.length)];
        return prisma.twitchChannel.updateMany({
          where: { id: c.id, colorHex: null },
          data: { colorHex: defaultColorHex },
        });
      })
    );

    for (const c of missingColor) {
      c.colorHex = DEFAULT_CHANNEL_COLORS[hashStringToIndex(c.broadcasterId || c.login || c.id, DEFAULT_CHANNEL_COLORS.length)];
    }
  }

  return { channels };
}

export default async function AdminTwitchPage() {
  const session = await requireAdmin();

  async function moveChannel(formData) {
    'use server';

    await requireAdmin();

    const channelId = String(formData.get('channelId') || '');
    const direction = String(formData.get('direction') || '');
    if (!channelId) return;
    if (direction !== 'up' && direction !== 'down') return;

    const channels = await prisma.twitchChannel.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    });

    const idx = channels.findIndex((c) => c.id === channelId);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === channels.length - 1) return;

    const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
    const a = channels[idx];
    const b = channels[otherIdx];
    if (!a || !b) return;

    await prisma.$transaction([
      prisma.twitchChannel.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      prisma.twitchChannel.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);

    redirect('/admin/twitch');
  }

  async function addChannel(formData) {
    'use server';

    await requireAdmin();

    const loginRaw = formData.get('login');
    const login = String(loginRaw || '').trim().toLowerCase();
    if (!login) return;

    const twitchUser = await getTwitchUserByLogin(login);
    if (!twitchUser) {
      redirect(`/admin/twitch?error=${encodeURIComponent('Channel not found on Twitch')}`);
    }

    const existing = await prisma.twitchChannel.findUnique({
      where: { broadcasterId: twitchUser.id },
      select: { id: true, colorHex: true, sortOrder: true },
    });

    const count = await prisma.twitchChannel.count();
    const defaultColorHex = DEFAULT_CHANNEL_COLORS[count % DEFAULT_CHANNEL_COLORS.length];

    const maxSort = await prisma.twitchChannel.aggregate({
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxSort?._max?.sortOrder ?? -1) + 1;

    await prisma.twitchChannel.upsert({
      where: { broadcasterId: twitchUser.id },
      create: {
        login: twitchUser.login,
        broadcasterId: twitchUser.id,
        displayName: twitchUser.displayName,
        colorHex: defaultColorHex,
        sortOrder: nextSortOrder,
      },
      update: {
        login: twitchUser.login,
        displayName: twitchUser.displayName,
        isEnabled: true,
        ...(existing && !existing.colorHex ? { colorHex: defaultColorHex } : {}),
      },
    });

    redirect('/admin/twitch');
  }

  async function pollNow() {
    'use server';

    await requireAdmin();

    const secret = process.env.CRON_SECRET;
    const headers = secret ? { Authorization: `Bearer ${secret}` } : {};

    const res = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/cron/poll`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Poll failed: ${res.status} ${text}`);
    }

    redirect('/admin/twitch');
  }

  const { channels } = await loadData();

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Heading size="3">Twitch</Heading>
        <Text size="2" color="gray">
          Track channels and periodically sync schedule + live status using a Twitch app access token.
        </Text>
        <Text size="2">
          <Link href="/admin/users">Go to Users</Link>
        </Text>
      </Flex>

      <Flex direction="column" gap="3">
        <Heading size="3">Add channel</Heading>
        <form action={addChannel}>
          <Flex gap="2" align="end" wrap="wrap">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Channel login
              </Text>
              <input
                name="login"
                required
                placeholder="e.g. somechannel"
                style={{
                  width: 260,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>
            <Button type="submit">Add</Button>
          </Flex>
        </form>
      </Flex>

      <Flex direction="column" gap="3">
        <Flex gap="2" align="center" wrap="wrap">
          <Heading size="3">Channels</Heading>
          <form action={pollNow}>
            <Button variant="soft" type="submit">
              Poll now
            </Button>
          </form>
        </Flex>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Login</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>TZ</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Color</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Actions</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Order</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: '8px 6px' }}>{c.login}</td>
                  <td style={{ padding: '8px 6px' }}>{c.timeZone || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <Flex gap="2" align="center" wrap="wrap">
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          background: c.colorHex || 'transparent',
                          border: '1px solid rgba(255,255,255,0.25)',
                          display: 'inline-block',
                        }}
                      />
                      <Text size="2" color="gray" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                        {c.colorHex || '-'}
                      </Text>
                    </Flex>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <Button asChild variant="soft">
                      <Link href={`/admin/twitch/${c.id}`}>View / Edit</Link>
                    </Button>
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <Flex gap="2" align="center" wrap="wrap">
                      <form action={moveChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="direction" value="up" />
                        <Button variant="soft" type="submit">
                          Up
                        </Button>
                      </form>
                      <form action={moveChannel}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="direction" value="down" />
                        <Button variant="soft" type="submit">
                          Down
                        </Button>
                      </form>
                    </Flex>
                  </td>
                </tr>
              ))}
              {channels.length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={5}>
                    <Text color="gray" size="2">
                      No channels yet.
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
