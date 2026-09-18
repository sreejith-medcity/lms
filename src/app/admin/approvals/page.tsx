import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { batchWhere, scopeNote, staffScope } from '@/lib/scope';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The Branch Head's queue: every sheet submitted in their branch, oldest
 * first, with who submitted it and how much of the batch it covers. A
 * teacher opening this sees why it is empty for them.
 */
export default async function ApprovalsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const scope = await staffScope(me);
  const tz = tenant.timezone;

  if (scope.kind === 'batches') {
    return (
      <div>
        <PageHeader title="Approvals" description="Results are approved by the Branch Head of the batch's branch." />
        <EmptyState title="Nothing for you to approve" hint="A teacher submits mark sheets; the Branch Head approves them. Yours are under Mark sheets." />
      </div>
    );
  }

  const [waiting, recent] = await Promise.all([
    db.markSheet.findMany({
      where: { organizationId: tenant.organizationId, status: 'SUBMITTED', batch: batchWhere(scope) },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      select: { id: true, title: true, category: true, testDate: true, submittedAt: true, submittedById: true, version: true, supersedesId: true, batch: { select: { name: true, branch: { select: { name: true } }, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] } } } } } } }, _count: { select: { entries: true } } },
    }),
    db.markSheet.findMany({
      where: { organizationId: tenant.organizationId, status: { in: ['PUBLISHED', 'RETURNED'] }, decidedAt: { not: null }, batch: batchWhere(scope) },
      orderBy: { decidedAt: 'desc' },
      take: 15,
      select: { id: true, title: true, status: true, decidedAt: true, batch: { select: { name: true } } },
    }),
  ]);
  const submitterIds = Array.from(new Set(waiting.map((w) => w.submittedById).filter((x): x is string => Boolean(x))));
  const names = submitterIds.length ? new Map((await db.user.findMany({ where: { id: { in: submitterIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();
  const note = scopeNote(scope);

  return (
    <div>
      <PageHeader title="Approvals" description={`Mark sheets waiting for a decision, oldest first. Parents see nothing until you publish.${note ? ` ${note}` : ''}`} />
      {waiting.length === 0 ? (
        <EmptyState title="Nothing waiting" hint="Submitted sheets appear here the moment a teacher presses submit." />
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {waiting.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/marksheets/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.title}
                      {s.supersedesId && <span className="t-micro faint"> · correction, v{s.version}</span>}
                    </p>
                    <p className="t-small faint truncate">
                      {s.batch.name} · {s.batch.branch.name} · {s.category} · {formatDayLabel(dayKey(s.testDate, tz), tz)}
                    </p>
                    <p className="t-micro faint">
                      Submitted {s.submittedAt ? formatDayLabel(dayKey(s.submittedAt, tz), tz) : ''}
                      {s.submittedById ? ` by ${names.get(s.submittedById) ?? 'a teacher'}` : ''} · {s._count.entries} of {s.batch._count.enrollments} learners
                    </p>
                  </div>
                  <Badge tone={s._count.entries < s.batch._count.enrollments ? 'warn' : 'neutral'}>{s._count.entries < s.batch._count.enrollments ? 'lines missing' : 'complete'}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {recent.length > 0 && (
        <div className="mt-6">
          <h2 className="t-heading mb-2">Decided recently</h2>
          <Card padded={false}>
            <ul className="divide-y">
              {recent.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <Link href={`/admin/marksheets/${s.id}`} className="truncate hover:underline">
                    {s.title} <span className="faint">· {s.batch.name}</span>
                  </Link>
                  <span className="shrink-0">
                    <Badge tone={s.status === 'PUBLISHED' ? 'ok' : 'bad'}>{s.status === 'PUBLISHED' ? 'published' : 'returned'}</Badge>
                    <span className="t-micro faint ml-2">{s.decidedAt ? formatDayLabel(dayKey(s.decidedAt, tz), tz) : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
