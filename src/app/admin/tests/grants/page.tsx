import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { examFamilies } from '@/lib/exams/registry';
import { TEST_PERMS } from '@/lib/exams/perms';
import { GrantForm, RevokeButton } from '../editors';

export const dynamic = 'force-dynamic';

const SOURCE: Record<string, string> = { GRANT: 'given', PACK: 'bought', SAMPLE: 'free sample', COURSE: 'course' };

export default async function Grants({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireTenant();
  const user = await requireStaff(TEST_PERMS.grants, 'view');
  const mayGive = can(user.permissions, TEST_PERMS.grants, 'edit');
  const mayRevoke = can(user.permissions, TEST_PERMS.grants, 'delete');
  const q = (sp.q ?? '').trim();

  const rows = await db.examAllowance.findMany({
    where: {
      organizationId: tenant.organizationId,
      ...(q ? { user: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } } : { source: { not: 'COURSE' } }),
    },
    orderBy: { grantedAt: 'desc' },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });
  const targets = examFamilies().flatMap((f) => [
    ...f.levels.map((l) => ({ value: `${f.family}:${l}`, label: `${f.name} ${l}` })),
    ...(f.levels.length > 1 ? [{ value: `${f.family}:`, label: `${f.name}, any level` }] : f.levels.length ? [] : [{ value: `${f.family}:`, label: f.name }]),
  ]);
  const now = new Date();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title={q ? `Allowances for “${q}”` : 'Given, bought and sample papers'}>
        <form className="mb-2">
          <input name="q" defaultValue={q} placeholder="Find a learner (shows course allowances too)" className="w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm" />
        </form>
        {rows.length === 0 ? (
          <EmptyState title="None yet" hint="Course allowances come with enrolments on their own; the ones given here are extra." />
        ) : (
          <Table head={['Learner', 'For', 'Used', 'Kind', '']}>
            {rows.map((a) => {
              const over = a.revokedAt != null || (a.expiresAt != null && a.expiresAt < now);
              return (
                <Row key={a.id}>
                  <Cell>
                    <span className="font-medium">{a.user.name}</span>
                    <p className="t-small faint">{a.user.email}</p>
                  </Cell>
                  <Cell>
                    {a.familyCode} {a.level ?? 'any level'}
                    {a.expiresAt && <p className="t-small faint">until {a.expiresAt.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: tenant.timezone })}</p>}
                  </Cell>
                  <Cell className="tabular-nums">
                    {a.used} / {a.tests ?? '∞'}
                  </Cell>
                  <Cell>
                    <Badge tone={over ? 'neutral' : 'brand'}>{a.revokedAt ? 'withdrawn' : over ? 'expired' : SOURCE[a.source]}</Badge>
                    {a.note && <p className="t-small faint mt-1">{a.note}</p>}
                  </Cell>
                  <Cell className="text-right">{mayRevoke && !a.revokedAt && a.source !== 'COURSE' && <RevokeButton id={a.id} />}</Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Section>
      {mayGive && (
        <Section title="Give papers">
          <Card>
            <GrantForm targets={targets} />
          </Card>
        </Section>
      )}
    </div>
  );
}
