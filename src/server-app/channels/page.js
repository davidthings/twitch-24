import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function ChannelsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const channels = await prisma.twitchChannel.findMany({
    where: { isEnabled: true },
    orderBy: [{ login: 'asc' }],
    select: {
      id: true,
      login: true,
      displayName: true,
      timeZone: true,
      lastScheduleSyncAt: true,
      lastStreamSyncAt: true,
      _count: {
        select: {
          scheduleSegments: true,
          streamSnapshots: true,
        },
      },
    },
  });

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Heading size="4">Channels</Heading>
        <Text size="2" color="gray">
          Tracked Twitch channels.
        </Text>
      </Flex>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Channel</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>TZ</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Schedule segs</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Stream snaps</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id}>
                <td style={{ padding: '8px 6px' }}>{c.displayName || c.login}</td>
                <td style={{ padding: '8px 6px' }}>{c.timeZone || '-'}</td>
                <td style={{ padding: '8px 6px' }}>{c._count.scheduleSegments}</td>
                <td style={{ padding: '8px 6px' }}>{c._count.streamSnapshots}</td>
                <td style={{ padding: '8px 6px' }}>
                  <Button asChild variant="soft">
                    <Link href={`/app/channels/${c.id}`}>View</Link>
                  </Button>
                </td>
              </tr>
            ))}
            {channels.length === 0 ? (
              <tr>
                <td style={{ padding: '8px 6px' }} colSpan={5}>
                  <Text size="2" color="gray">
                    No channels yet.
                  </Text>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Flex>
  );
}
