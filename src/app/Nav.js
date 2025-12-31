'use client';

import { Flex, Link } from '@radix-ui/themes';

export default function Nav() {
  return (
    <Flex gap="3" align="center" wrap="wrap">
      <Link href="/">Home</Link>
      <Link href="/twitch/login/">Twitch Login</Link>
      <Link href="/twitch/me/">Twitch Me</Link>
    </Flex>
  );
}
