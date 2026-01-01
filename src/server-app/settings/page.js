import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import TimeZonePicker from './TimeZonePicker';

async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return session;
}

export default async function SettingsPage() {
  const session = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, timeZone: true },
  });

  if (!user) redirect('/login');

  async function updateTimeZone(formData) {
    'use server';

    const session2 = await requireUser();

    const timeZoneRaw = formData.get('timeZone');
    const timeZone = String(timeZoneRaw || '').trim();

    if (!timeZone) return;

    await prisma.user.update({
      where: { id: session2.user.id },
      data: { timeZone },
    });

    redirect('/app/settings');
  }

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Heading size="4">Settings</Heading>
        <Text size="2" color="gray">
          Signed in as {user.email}
        </Text>
      </Flex>

      <Flex direction="column" gap="3">
        <Heading size="3">Time zone</Heading>
        <Text size="2" color="gray">
          Times in the app will be displayed in this time zone.
        </Text>

        <form action={updateTimeZone}>
          <Flex gap="2" align="end" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">
                Time zone
              </Text>
              <TimeZonePicker
                initialTimeZone={user.timeZone || 'UTC'}
                variant="chip"
                label="Time zone"
                placeholder="Type to filter…"
              />
            </Flex>

            <Button type="submit">Save</Button>
          </Flex>
        </form>
      </Flex>
    </Flex>
  );
}
