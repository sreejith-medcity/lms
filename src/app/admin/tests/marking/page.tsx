import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { EXAM_FORMATS } from '@/lib/exams/registry';
import { TEST_PERMS } from '@/lib/exams/perms';

export const dynamic = 'force-dynamic';

/**
 * What waits for a person: answers the model has not marked (no key, or it
 * failed), and, for spot checks, the model's recent marks no tutor has
 * looked at.
 */
export default async function Marking() {
  const tenant = await requireTenant();
  await requireStaff(TEST_PERMS.sittings, 'view');
  const organizationId = tenant.organizationId;
  const base = { tutorPoints: null, sitting: { status: { in: ['SUBMITTED' as const, 'EVALUATED' as const] } } };
  const select = {
    id: true,
    kind: true,
    title: true,
    aiPoints: true,
    aiMax: true,
    aiError: true,
    createdAt: true,
    sitting: { select: { id: true, formatCode: true, user: { select: { name: true } } } },
  } as const;
  const [waiting, byModel] = await Promise.all([
    db.examSubmission.findMany({ where: { organizationId, ...base, aiPoints: null }, orderBy: { createdAt: 'asc' }, take: 100, select }),
    db.examSubmission.findMany({ where: { organizationId, ...base, aiPoints: { not: null }, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, orderBy: { createdAt: 'desc' }, take: 50, select }),
  ]);
  const nameOf = (code: string) => EXAM_FORMATS.find((f) => f.code === code)?.name ?? code;
  const rows = (list: typeof waiting, model: boolean) => (
    <Table head={['Learner', 'Task', model ? "Model's mark" : 'Why it waits', 'Handed in', '']}>
      {list.map((s) => (
        <Row key={s.id}>
          <Cell className="font-medium">{s.sitting.user.name}</Cell>
          <Cell>
            {s.title || s.kind.toLowerCase()} <p className="t-small faint">{nameOf(s.sitting.formatCode)}, {s.kind === 'WRITING' ? 'writing' : 'speaking'}</p>
          </Cell>
          <Cell className="t-small">{model ? `${s.aiPoints} / ${s.aiMax}` : s.aiError ? `The model failed: ${s.aiError.slice(0, 80)}` : 'Not marked yet'}</Cell>
          <Cell className="t-small tabular-nums">{s.createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone })}</Cell>
          <Cell className="text-right">
            <Link href={`/admin/tests/sittings/${s.sitting.id}`} className="t-small underline">
              Mark
            </Link>
          </Cell>
        </Row>
      ))}
    </Table>
  );
  return (
    <div className="space-y-8">
      <Section title="Waiting for a mark">
        {waiting.length ? rows(waiting, false) : <EmptyState title="Nothing waiting" hint="Every writing and speaking answer handed in has a mark." />}
      </Section>
      <Section title="Marked by the model, not yet checked (14 days)">
        {byModel.length ? rows(byModel, true) : <p className="t-small muted">None.</p>}
      </Section>
    </div>
  );
}
