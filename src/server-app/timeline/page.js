import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import PixiTimeline from './PixiTimeline';

export default async function TimelinePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  const initialNowMs = Date.now();
  const isAdmin = session.user?.role === 'admin';

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="2">
          <Heading size="4">Timeline</Heading>
          <Text color="gray" size="2">
            Multi-channel schedule + VOD timeline with linear and spiral layouts.
          </Text>
        </Flex>
      </Card>

      <PixiTimeline userTimeZone={session.user?.timeZone || 'UTC'} initialNowMs={initialNowMs} isAdmin={isAdmin} />
    </Flex>
  );
}
