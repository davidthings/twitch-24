import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@next-auth/prisma-adapter';

import { prisma } from '@/lib/prisma';

async function sendMagicLinkEmail({ identifier, url }) {
  const from = process.env.EMAIL_FROM;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!from) {
    throw new Error('EMAIL_FROM is not set');
  }

  if (!resendApiKey) {
    // Dev fallback: print the magic link to the server console.
    // This keeps local development simple.
    // eslint-disable-next-line no-console
    console.log(`Magic link for ${identifier}: ${url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: identifier,
      subject: 'Sign in to twitch-24',
      text: `Sign in: ${url}`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send email: ${res.status} ${text}`);
  }
}

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    EmailProvider({
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: sendMagicLinkEmail,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'database',
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      const email = user?.email?.toLowerCase();
      if (!email) return false;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return existingUser.status === 'active';
      }

      const invite = await prisma.invite.findUnique({ where: { email } });
      return Boolean(invite && !invite.usedAt);
    },
    async session({ session, user }) {
      if (session?.user) {
        session.user.id = user.id;
        session.user.role = user.role;
        session.user.status = user.status;
        session.user.timeZone = user.timeZone;
      }

      return session;
    },
  },
  events: {
    async createUser({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return;

      const invite = await prisma.invite.findUnique({ where: { email } });

      if (!invite || invite.usedAt) {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'disabled' },
        });
        return;
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            role: invite.role,
            status: 'active',
          },
        }),
        prisma.invite.update({
          where: { email },
          data: { usedAt: new Date() },
        }),
      ]);
    },
  },
};
