'use client';

import NextLink from 'next/link';
import { Flex, Link } from '@radix-ui/themes';

export default function Nav() {
  return (
    <Flex gap="3" align="center" wrap="wrap">
      <Link asChild>
        <NextLink href="/">Home</NextLink>
      </Link>
      <Link asChild>
        <NextLink href="/channels/">Channels</NextLink>
      </Link>
      <Link asChild>
        <NextLink href="/timeline/">Timeline</NextLink>
      </Link>
      <Link asChild>
        <NextLink href="/twitch/login/">Twitch Login</NextLink>
      </Link>
      <Link asChild>
        <NextLink href="/twitch/me/">Twitch Me</NextLink>
      </Link>
      <Link asChild>
        <NextLink href="/twitch/debug/">Twitch Debug</NextLink>
      </Link>
    </Flex>
  );
}
