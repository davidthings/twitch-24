'use client';

import { useSession, signOut } from 'next-auth/react';
import { Button, Flex, Link, Text } from '@radix-ui/themes';

export default function Nav() {
  const { data: session, status } = useSession();
  const role = session?.user?.role;

  return (
    <Flex gap="3" align="center" wrap="wrap">
      <Link href="/">Home</Link>
      <Link href="/app">App</Link>
      {session ? <Link href="/app/timeline">Timeline</Link> : null}
      {session ? <Link href="/app/channels">Channels</Link> : null}
      {session ? <Link href="/app/settings">Settings</Link> : null}
      {role === 'admin' ? <Link href="/admin/users">Admin</Link> : null}
      {role === 'admin' ? <Link href="/admin/twitch">Twitch</Link> : null}

      <Flex ml="auto" gap="3" align="center">
        {status === 'loading' ? <Text color="gray">Loading…</Text> : null}

        {session ? (
          <Button variant="soft" onClick={() => signOut({ callbackUrl: '/' })}>
            Sign out
          </Button>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </Flex>
    </Flex>
  );
}
