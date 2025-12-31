'use client';

import { useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

export default function LoginPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const error = params.get('error');
  const checkEmail = params.get('checkEmail');

  const errorText = useMemo(() => {
    if (!error) return null;
    if (error === 'AccessDenied') return 'Access denied. You may not be invited, or your account is disabled.';
    return `Login error: ${error}`;
  }, [error]);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);

    try {
      await signIn('email', {
        email,
        callbackUrl: '/app',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Heading size="4">Sign in</Heading>

        {checkEmail ? (
          <Text color="gray">Check your email for a sign-in link.</Text>
        ) : (
          <Text color="gray">Enter your email and we’ll send you a magic link.</Text>
        )}

        {errorText ? <Text color="red">{errorText}</Text> : null}

        <form onSubmit={onSubmit}>
          <Flex direction="column" gap="3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: 'inherit',
              }}
            />

            <Button type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send magic link'}
            </Button>
          </Flex>
        </form>

        <Text size="2" color="gray">
          Invite-only: if your email isn’t invited, sign-in will be denied.
        </Text>
      </Flex>
    </Card>
  );
}
