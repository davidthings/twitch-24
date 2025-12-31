'use client';

import { useEffect, useState } from 'react';
import { Box, Button, Card, Code, Flex, Heading, Separator, Text, TextField, Callout } from '@radix-ui/themes';

import { buildAuthUrl, buildRedirectUri, generateState } from '@/lib/twitchAuth/oauth';
import { loadSettings, saveSettings } from '@/lib/twitchAuth/settings';
import { useTwitchAuth } from '@/lib/twitchAuth/useTwitchAuth';

export default function TwitchLoginPage() {
  const { authed, user, ready } = useTwitchAuth();
  const [twitchClientId, setTwitchClientId] = useState('');
  const [twitchClientSecret, setTwitchClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setTwitchClientId(s.twitchClientId || '');
    setTwitchClientSecret(s.twitchClientSecret || '');
    if (typeof window !== 'undefined') {
      setRedirectUri(buildRedirectUri());
    }
  }, []);

  function onLogin() {
    // Ensure the OAuth flow uses the currently typed credentials.
    saveSettings({ twitchClientId, twitchClientSecret });

    const state = generateState();
    try {
      sessionStorage.setItem('oauth_state', state);
    } catch {
      // ignore
    }

    const scopes = ['user:read:email'];
    const url = buildAuthUrl({ scopes, state, clientId: twitchClientId });
    window.location.href = url;
  }

  function onSaveSettings() {
    saveSettings({ twitchClientId, twitchClientSecret });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <Box>
      <Heading size="6" mb="2">
        Twitch Login
      </Heading>
      <Text size="2" color="gray">
        Static app using Twitch OAuth (Implicit) and Helix.
      </Text>

      <Separator my="4" />

      <Card size="3" mb="4">
        <Flex direction="column" gap="3">
          <Heading size="5">Setup — Twitch App Credentials</Heading>
          <Text size="3">Enter your Twitch credentials. These are stored in your browser only.</Text>

          <Flex direction="column" gap="2">
            <label>
              <Text as="div" size="2" color="gray">
                Twitch Client ID
              </Text>
              <TextField.Root
                value={twitchClientId}
                onChange={(e) => setTwitchClientId(e.target.value)}
                placeholder="u796di1d..."
              />
            </label>

            <label>
              <Text as="div" size="2" color="gray">
                Twitch Client Secret
              </Text>
              <TextField.Root
                type="password"
                value={twitchClientSecret}
                onChange={(e) => setTwitchClientSecret(e.target.value)}
                placeholder="••••••"
              />
            </label>

            <label>
              <Text as="div" size="2" color="gray">
                Redirect URI
              </Text>
              <Code>{redirectUri || '—'}</Code>
            </label>
          </Flex>

          <Flex gap="3" align="center" wrap="wrap">
            <Button onClick={onSaveSettings}>Save</Button>
            {saved ? <Text color="green">Saved</Text> : null}
          </Flex>

          <Callout.Root>
            <Callout.Text>
              <strong>How to get these:</strong>
              <br />
              - Go to{' '}
              <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
                Twitch Developer Console
              </a>{' '}
              and create an app.
              <br />
              - Copy the <Code>Client ID</Code>. Generate a <Code>Client Secret</Code> (not used by this SPA but stored
              for future backend use).
              <br />
              - Add your Redirect URI. For GitHub Pages repo site, use:{' '}
              <Code>https://&lt;user&gt;.github.io/&lt;repo&gt;/twitch/callback/</Code>. For local dev, use:{' '}
              <Code>http://localhost:3000/twitch/callback/</Code>.
            </Callout.Text>
          </Callout.Root>
        </Flex>
      </Card>

      {!ready ? (
        <Card size="3">
          <Text>Loading…</Text>
        </Card>
      ) : !authed ? (
        <Card size="3">
          <Flex direction="column" gap="3">
            <Text size="3">Sign in to enable API calls.</Text>
            <Button onClick={onLogin} size="3" disabled={!twitchClientId}>
              Sign in with Twitch
            </Button>
            {!twitchClientId ? (
              <Text size="2" color="red">
                Provide a Client ID above to enable sign-in.
              </Text>
            ) : null}
          </Flex>
        </Card>
      ) : (
        <Card size="3">
          <Flex direction="column" gap="3">
            <Text size="3">
              Signed in as <strong>{user?.display_name || user?.login || 'user'}</strong>
            </Text>
            <Button asChild>
              <a href="/twitch/me/">Go to /twitch/me</a>
            </Button>
          </Flex>
        </Card>
      )}
    </Box>
  );
}
