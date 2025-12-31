import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Button, Flex, Heading, Text } from '@radix-ui/themes';

import { authOptions } from '@/lib/auth';
import { formatInTimeZone } from '@/lib/datetime';
import { prisma } from '@/lib/prisma';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user?.role !== 'admin') redirect('/app');
  return session;
}

async function loadData() {
  const [users, invites] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.invite.findMany({
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        email: true,
        role: true,
        usedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return { users, invites };
}

export default async function AdminUsersPage() {
  const session = await requireAdmin();
  const timeZone = session.user?.timeZone || 'UTC';

  async function createInvite(formData) {
    'use server';

    await requireAdmin();

    const emailRaw = formData.get('email');
    const roleRaw = formData.get('role');

    const email = String(emailRaw || '').trim().toLowerCase();
    const role = String(roleRaw || 'user').trim();

    if (!email) return;

    await prisma.invite.upsert({
      where: { email },
      create: {
        email,
        role,
      },
      update: {
        role,
        usedAt: null,
      },
    });

    redirect('/admin/users');
  }

  async function setUserStatus(formData) {
    'use server';

    await requireAdmin();

    const userId = String(formData.get('userId') || '');
    const status = String(formData.get('status') || '');

    if (!userId || (status !== 'active' && status !== 'disabled')) return;

    await prisma.user.update({
      where: { id: userId },
      data: { status },
    });

    redirect('/admin/users');
  }

  async function setUserRole(formData) {
    'use server';

    await requireAdmin();

    const userId = String(formData.get('userId') || '');
    const role = String(formData.get('role') || '').trim();

    if (!userId || !role) return;

    await prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    redirect('/admin/users');
  }

  const { users, invites } = await loadData();

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="3">
        <Heading size="3">Invites</Heading>
        <Text color="gray" size="2">
          Create an invite to allow a user to sign in. If the user signs in, the invite will be marked used.
        </Text>

        <form action={createInvite}>
          <Flex gap="2" align="end" wrap="wrap">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Email
              </Text>
              <input
                name="email"
                type="email"
                required
                placeholder="user@example.com"
                style={{
                  width: 320,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text size="2" color="gray">
                Role
              </Text>
              <select
                name="role"
                defaultValue="user"
                style={{
                  width: 160,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'inherit',
                }}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <Button type="submit">Create invite</Button>
          </Flex>
        </form>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Used</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td style={{ padding: '8px 6px' }}>{invite.email}</td>
                  <td style={{ padding: '8px 6px' }}>{invite.role}</td>
                  <td style={{ padding: '8px 6px' }}>{invite.usedAt ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px 6px' }}>{formatInTimeZone(invite.createdAt, timeZone)}</td>
                </tr>
              ))}
              {invites.length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={4}>
                    <Text color="gray" size="2">
                      No invites yet.
                    </Text>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Flex>

      <Flex direction="column" gap="3">
        <Heading size="3">Users</Heading>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Created</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ padding: '8px 6px' }}>{user.email}</td>
                  <td style={{ padding: '8px 6px' }}>{user.role}</td>
                  <td style={{ padding: '8px 6px' }}>{user.status}</td>
                  <td style={{ padding: '8px 6px' }}>{formatInTimeZone(user.createdAt, timeZone)}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <Flex gap="2" wrap="wrap">
                      <form action={setUserStatus}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={user.status === 'active' ? 'disabled' : 'active'}
                        />
                        <Button variant="soft" type="submit">
                          {user.status === 'active' ? 'Disable' : 'Enable'}
                        </Button>
                      </form>

                      <form action={setUserRole}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="role" value={user.role === 'admin' ? 'user' : 'admin'} />
                        <Button variant="soft" type="submit">
                          Make {user.role === 'admin' ? 'user' : 'admin'}
                        </Button>
                      </form>
                    </Flex>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td style={{ padding: '8px 6px' }} colSpan={5}>
                    <Text color="gray" size="2">
                      No users yet.
                    </Text>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Flex>
    </Flex>
  );
}
