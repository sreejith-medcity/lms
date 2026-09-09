import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { AddMemberForm, MemberControls } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function TeamPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.roles', 'view');
  const canEdit = me.permissions['settings.roles']?.edit ?? false;

  const [members, roles, branches] = await Promise.all([
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'STAFF', deletedAt: null },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        lastSeenAt: true,
        mustResetPassword: true,
        roleAssignments: { select: { role: { select: { id: true, name: true } } } },
        branchMemberships: { select: { branch: { select: { name: true } } } },
      },
    }),
    db.role.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    db.branch.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Everyone who can sign in to the admin. What each of them can do comes from their role, and roles are edited in Settings."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {members.length === 0 ? (
            <EmptyState title="Nobody on the team yet" hint="Add the first administrator." />
          ) : (
            <Table head={['Person', 'Role', 'Branch', 'Last seen']}>
              {members.map((m) => (
                <Row key={m.id}>
                  <Cell>
                    <span className="flex items-center gap-2 font-medium">
                      {m.name}
                      {m.id === me.id && <Badge tone="brand">you</Badge>}
                      {m.status === 'SUSPENDED' && <Badge tone="bad">suspended</Badge>}
                      {m.mustResetPassword && <Badge tone="warn">password not set</Badge>}
                    </span>
                    <span className="t-small faint block">{m.email ?? m.phone ?? '—'}</span>
                  </Cell>
                  <Cell>
                    {canEdit && m.id !== me.id ? (
                      <MemberControls
                        userId={m.id}
                        roles={roles}
                        currentRoleId={m.roleAssignments[0]?.role.id ?? ''}
                        status={m.status as 'ACTIVE' | 'SUSPENDED'}
                      />
                    ) : (
                      <span className="t-small">
                        {m.roleAssignments.map((r) => r.role.name).join(', ') || '—'}
                      </span>
                    )}
                  </Cell>
                  <Cell className="t-small">
                    {m.branchMemberships.map((b) => b.branch.name).join(', ') || 'All branches'}
                  </Cell>
                  <Cell className="t-small faint">
                    {m.lastSeenAt
                      ? m.lastSeenAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      : 'never'}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>

        {canEdit && (
          <Card>
            <h2 className="t-heading">Add someone</h2>
            <p className="t-small muted mt-1">
              They get a one-time password shown here once. Email is not connected yet, so pass it
              on yourself; they are made to change it at first sign-in either way.
            </p>
            <div className="mt-5">
              <AddMemberForm roles={roles} branches={branches} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
