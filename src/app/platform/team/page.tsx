import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { Card, Cell, PageHeader, Row, Table } from '@/components/ui';
import { AddUserForm } from './form';

export const dynamic = 'force-dynamic';

export default async function PlatformTeamPage() {
  const me = await getPlatformUser();
  if (!me) redirect('/platform/login');
  const users = await db.platformUser.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, isActive: true, lastSeenAt: true } });
  return (
    <div className="space-y-6">
      <PageHeader title="Console users" description="The people who run the platform. Owners add users; everyone else sees this list." />
      <Card padded={false}>
        <Table head={['Name', 'Email', 'Role', 'Last seen']}>
          {users.map((u) => (
            <Row key={u.id}>
              <Cell>{u.name}{!u.isActive && <span className="t-micro faint ml-2">inactive</span>}</Cell>
              <Cell>{u.email}</Cell>
              <Cell>{u.role.toLowerCase().replace('_', ' ')}</Cell>
              <Cell className="tabular-nums">{u.lastSeenAt ? u.lastSeenAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</Cell>
            </Row>
          ))}
        </Table>
      </Card>
      {me.role === 'OWNER' && (
        <Card>
          <h2 className="t-heading">Add a console user</h2>
          <div className="mt-4"><AddUserForm /></div>
        </Card>
      )}
    </div>
  );
}
