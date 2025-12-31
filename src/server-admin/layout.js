import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';

export default async function AdminLayout({ children }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  if (session.user?.role !== 'admin') {
    redirect('/app');
  }

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Heading size="4">Admin</Heading>
        <Text color="gray" size="2">
          Signed in as {session.user?.email}
        </Text>
        {children}
      </Flex>
    </Card>
  );
}
