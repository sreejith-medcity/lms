import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { maskContact } from '@/lib/parents';
import { settingNumber } from '@/lib/settings/store';
import { formatDateTime } from '@/lib/clock';
import { Card, PageHeader, Table, Row, Cell } from '@/components/ui';
import { RevokeButton } from './revoke';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Who is signed in, and the button that ends it. Parents by contact
 * (masked, the way the rest of the product shows them), staff by name.
 * Learners' sessions are on the learner's own page.
 */
export default async function SessionsSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.organization', 'view');
  const canEdit = me.permissions['settings.organization']?.edit ?? false;
  const now = new Date();

  const [parentSessions, staff, parentDays, staffDays] = await Promise.all([
    db.parentSession.findMany({ where: { organizationId: tenant.organizationId, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' }, select: { contact: true, lastSeenAt: true, createdAt: true }, take: 500 }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'STAFF', deletedAt: null, authSessions: { some: { expiresAt: { gt: now } } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, authSessions: { where: { expiresAt: { gt: now } }, select: { createdAt: true, userAgent: true }, orderBy: { createdAt: 'desc' } } },
      take: 300,
    }),
    settingNumber(tenant.organizationId, 'auth.parentSessionDays'),
    settingNumber(tenant.organizationId, 'auth.staffSessionDays'),
  ]);

  const byContact = new Map<string, { count: number; lastSeenAt: Date; since: Date }>();
  for (const s of parentSessions) {
    const hit = byContact.get(s.contact);
    if (!hit) byContact.set(s.contact, { count: 1, lastSeenAt: s.lastSeenAt, since: s.createdAt });
    else {
      hit.count += 1;
      if (s.lastSeenAt > hit.lastSeenAt) hit.lastSeenAt = s.lastSeenAt;
      if (s.createdAt < hit.since) hit.since = s.createdAt;
    }
  }

  return (
    <div>
      <PageHeader title="Signed-in devices" description={`A parent stays signed in ${parentDays} days, staff ${staffDays} (Preferences, Signing up and in). Ending someone's sessions signs every device out at once and stops push to it; their next visit asks for a code or password.`} />
      <div className="space-y-6">
        <Card>
          <h2 className="t-heading">Parents</h2>
          {byContact.size === 0 ? (
            <p className="t-small faint mt-2">No parent is signed in.</p>
          ) : (
            <div className="mt-3">
              <Table head={['Contact', 'Devices', 'Last used', '']}>
                {Array.from(byContact.entries()).map(([contact, s]) => (
                  <Row key={contact}>
                    <Cell>{maskContact(contact)}</Cell>
                    <Cell className="tabular-nums">{s.count}</Cell>
                    <Cell className="tabular-nums">{formatDateTime(s.lastSeenAt, tenant.timezone)}</Cell>
                    <Cell>
                      <RevokeButton kind="parent" id={contact} disabled={!canEdit} />
                    </Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="t-heading">Teachers and staff</h2>
          {staff.length === 0 ? (
            <p className="t-small faint mt-2">Nobody is signed in.</p>
          ) : (
            <div className="mt-3">
              <Table head={['Person', 'Devices', 'Most recent sign-in', '']}>
                {staff.map((u) => (
                  <Row key={u.id}>
                    <Cell>
                      {u.name}
                      <span className="t-small faint block">{u.email}</span>
                    </Cell>
                    <Cell className="tabular-nums">{u.authSessions.length}</Cell>
                    <Cell className="tabular-nums">{u.authSessions[0] ? formatDateTime(u.authSessions[0].createdAt, tenant.timezone) : ''}</Cell>
                    <Cell>
                      <RevokeButton kind="staff" id={u.id} disabled={!canEdit || u.id === me.id} />
                    </Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
