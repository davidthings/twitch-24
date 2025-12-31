import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import SignOutButton from './SignOutButton';

export default async function AppHomePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Heading size="4">App</Heading>
          <SignOutButton />
        </Flex>

        <Text color="gray">Signed in as: {session.user?.email}</Text>
        <Text color="gray">Role: {session.user?.role}</Text>
      </Flex>
    </Card>
  );
}
