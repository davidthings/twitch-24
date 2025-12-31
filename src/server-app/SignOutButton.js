'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@radix-ui/themes';

export default function SignOutButton() {
  return (
    <Button
      variant="soft"
      onClick={() => signOut({ callbackUrl: '/' })}
    >
      Sign out
    </Button>
  );
}
