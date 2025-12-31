'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Card, Code, Flex, Heading, Text } from '@radix-ui/themes';

import { parseHashFragment, toPath, validateToken } from '@/lib/twitchAuth/oauth';
import { getMe } from '@/lib/twitchAuth/helix';
import { saveToken } from '@/lib/twitchAuth/tokenStorage';

export default function TwitchCallbackPage() {
  const [status, setStatus] = useState('Processing OAuth response...');
  const [error, setError] = useState(null);
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    async function run() {
      try {
        const query = new URLSearchParams(window.location.search || '');
        const queryError = query.get('error');
        if (queryError) {
          throw new Error(`${queryError}: ${query.get('error_description') || ''}`);
        }

        const params = parseHashFragment(window.location.hash);
        if (params.error) throw new Error(`${params.error}: ${params.error_description || ''}`);

        const expectedState = sessionStorage.getItem('oauth_state');
        if (!params.state || !expectedState || params.state !== expectedState) {
          throw new Error('State mismatch');
        }
        sessionStorage.removeItem('oauth_state');

        const access_token = params.access_token;
        const token_type = params.token_type;
        const scope = (params.scope || '').split(' ').filter(Boolean);
        const expires_in = Number(params.expires_in || 0);
        if (!access_token) throw new Error('Missing access_token');

        setStatus('Validating token...');
        const v = await validateToken(access_token);
        const now = Date.now();
        const expires_at = now + Math.max(0, (expires_in || v.expires_in || 0) - 60) * 1000;

        saveToken({ access_token, token_type, scope, expires_in, expires_at });

        setStatus('Fetching user profile...');
        const me = await getMe();
        const user = me.data?.[0] || null;
        if (!user) throw new Error('Failed to fetch user');

        saveToken({ access_token, token_type, scope, expires_in, expires_at, user });

        setStatus('All set. Redirecting...');
        window.location.replace(toPath('/twitch/me/'));
      } catch (e) {
        console.error(e);
        setError(e.message || String(e));
        setStatus('');
      }
    }

    run();
  }, []);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Heading size="4">OAuth Callback</Heading>
        {status ? <Text as="p">{status}</Text> : null}
        {error ? (
          <Box>
            <Text as="p" color="red">
              Error: <Code>{error}</Code>
            </Text>
          </Box>
        ) : null}
      </Flex>
    </Card>
  );
}
