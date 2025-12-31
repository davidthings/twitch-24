'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Flex, Heading, Text, Code } from '@radix-ui/themes';

import { getMe } from '@/lib/twitchAuth/helix';
import { clearToken, loadToken } from '@/lib/twitchAuth/tokenStorage';
import { toPath } from '@/lib/twitchAuth/oauth';
import { useTwitchAuth } from '@/lib/twitchAuth/useTwitchAuth';

export default function TwitchMePage() {
  const { authed, user, ready } = useTwitchAuth();
  const [freshUser, setFreshUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function run() {
      try {
        if (!authed) return;
        const me = await getMe();
        setFreshUser(me.data?.[0] || null);
      } catch (e) {
        setError(e.message || String(e));
      }
    }
    run();
  }, [authed]);

  const u = freshUser || user;

  function onLogout() {
    clearToken();
    window.location.replace(toPath('/twitch/login/'));
  }

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Heading size="4">Twitch Auth Status</Heading>

        {!ready ? <Text color="gray">Loading…</Text> : null}

        {ready && !authed ? (
          <Flex direction="column" gap="2">
            <Text color="gray">Not authenticated.</Text>
            <Button asChild>
              <a href={toPath('/twitch/login/')}>Login with Twitch</a>
            </Button>
          </Flex>
        ) : null}

        {ready && authed ? (
          <Flex direction="column" gap="2">
            <Text color="gray">Authenticated.</Text>
            {u ? (
              <Text>
                User: <Code>{u.display_name || u.login || u.id}</Code>
              </Text>
            ) : (
              <Text color="gray">No user loaded yet.</Text>
            )}
            {error ? (
              <Text color="red" size="2">
                {error}
              </Text>
            ) : null}

            <Button variant="soft" onClick={onLogout}>
              Clear token
            </Button>

            <Text size="2" color="gray">
              Token is stored in <Code>sessionStorage</Code>.
            </Text>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}
