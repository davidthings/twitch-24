import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { formatInTimeZone } from '@/lib/datetime';
import { prisma } from '@/lib/prisma';
import { getTwitchUserByLogin } from '@/lib/twitch';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user?.role !== 'admin') redirect('/app');
  return session;
}

async function loadData() {
  const channels = await prisma.twitchChannel.findMany({
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      login: true,
      broadcasterId: true,
      displayName: true,
      timeZone: true,
      isEnabled: true,
      pollSchedule: true,
      pollStreams: true,
      pollVideos: true,
      lastScheduleSyncAt: true,
      lastStreamSyncAt: true,
      lastVideoSyncAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          scheduleSegments: true,
          streamSnapshots: true,
          videos: true,
        },
      },
    },
  });

  return { channels };
}

export default async function AdminTwitchPage() {
  const session = await requireAdmin();
  const timeZone = session.user?.timeZone || 'UTC';

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

    await prisma.twitchChannel.upsert({
      where: { broadcasterId: twitchUser.id },
      create: {
        login: twitchUser.login,
        broadcasterId: twitchUser.id,
        displayName: twitchUser.displayName,
      },
      update: {
        login: twitchUser.login,
        displayName: twitchUser.displayName,
        isEnabled: true,
      },
    });

    redirect('/admin/twitch');
  }

  async function toggleChannel(formData) {
    'use server';

    await requireAdmin();

    const id = String(formData.get('id') || '');
    const field = String(formData.get('field') || '');

    if (!id) return;
    if (field !== 'isEnabled' && field !== 'pollSchedule' && field !== 'pollStreams' && field !== 'pollVideos') return;

    const current = await prisma.twitchChannel.findUnique({
      where: { id },
      select: { id: true, isEnabled: true, pollSchedule: true, pollStreams: true, pollVideos: true },
    });

    if (!current) return;

    await prisma.twitchChannel.update({
      where: { id },
      data: { [field]: !current[field] },
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
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Broadcaster ID</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>TZ</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Enabled</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Poll schedule</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Poll streams</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Poll videos</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Schedule segs</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Stream snaps</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Videos</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Last schedule</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Last stream</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Last video</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: '8px 6px' }}>{c.login}</td>
                  <td style={{ padding: '8px 6px' }}>{c.broadcasterId}</td>
                  <td style={{ padding: '8px 6px' }}>{c.timeZone || '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.isEnabled ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.pollSchedule ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.pollStreams ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.pollVideos ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px 6px' }}>{c._count.scheduleSegments}</td>
                  <td style={{ padding: '8px 6px' }}>{c._count.streamSnapshots}</td>
                  <td style={{ padding: '8px 6px' }}>{c._count.videos}</td>
                  <td style={{ padding: '8px 6px' }}>{c.lastScheduleSyncAt ? formatInTimeZone(c.lastScheduleSyncAt, timeZone) : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.lastStreamSyncAt ? formatInTimeZone(c.lastStreamSyncAt, timeZone) : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>{c.lastVideoSyncAt ? formatInTimeZone(c.lastVideoSyncAt, timeZone) : '-'}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <Flex gap="2" wrap="wrap">
                      <Button asChild variant="soft">
                        <Link href={`/admin/twitch/${c.id}`}>Details</Link>
                      </Button>

                      <form action={toggleChannel}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="field" value="isEnabled" />
                        <Button variant="soft" type="submit">
                          {c.isEnabled ? 'Disable' : 'Enable'}
                        </Button>
                      </form>

                      <form action={toggleChannel}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="field" value="pollSchedule" />
                        <Button variant="soft" type="submit">
                          Schedule: {c.pollSchedule ? 'on' : 'off'}
                        </Button>
                      </form>

                      <form action={toggleChannel}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="field" value="pollStreams" />
                        <Button variant="soft" type="submit">
                          Streams: {c.pollStreams ? 'on' : 'off'}
                        </Button>
                      </form>

                      <form action={toggleChannel}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="field" value="pollVideos" />
                        <Button variant="soft" type="submit">
                          Videos: {c.pollVideos ? 'on' : 'off'}
                        </Button>
                      </form>
                    </Flex>
                  </td>
                </tr>
              ))}
              {channels.length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={13}>
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
