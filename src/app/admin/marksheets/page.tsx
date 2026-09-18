import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { batchWhere, scopeNote, staffScope } from '@/lib/scope';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TONE = { DRAFT: 'neutral', SUBMITTED: 'warn', RETURNED: 'bad', PUBLISHED: 'ok' } as const;
const LABEL = { DRAFT: 'draft', SUBMITTED: 'with the Branch Head', RETURNED: 'returned', PUBLISHED: 'published' } as const;

/**
 * A teacher's mark sheets: what needs finishing first (returned, then
 * drafts), what is waiting on the Branch Head, and what is out.
 */
export default async function MarkSheetsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const scope = await staffScope(me);
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;
  const tz = tenant.timezone;

  const sheets = await db.markSheet.findMany({
    where: { organizationId: tenant.organizationId, batch: batchWhere(scope) },
    orderBy: [{ updatedAt: 'desc' }],
    take: 80,
    select: { id: true, title: true, category: true, status: true, testDate: true, version: true, supersededById: true, returnReason: true, batch: { select: { name: true } }, _count: { select: { entries: true } } },
  });
  const order = { RETURNED: 0, DRAFT: 1, SUBMITTED: 2, PUBLISHED: 3 } as const;
  const rows = sheets.filter((s) => !s.supersededById).sort((a, b) => order[a.status] - order[b.status]);
  const note = scopeNote(scope);

  return (
    <div>
      <PageHeader
        title="Mark sheets"
        description={`Marks for a test, entered for a batch and published by its Branch Head. Nothing reaches a parent before that.${note ? ` ${note}` : ''}`}
        action={canEdit ? <LinkButton href="/admin/marksheets/new">New mark sheet</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No mark sheets yet" hint="Start one for a test sat on paper, or draw one from an online paper's marks." />
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/marksheets/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.title}
                      {s.version > 1 && <span className="t-micro faint"> · v{s.version}</span>}
                    </p>
                    <p className="t-small faint truncate">
                      {s.batch.name} · {s.category} · {formatDayLabel(dayKey(s.testDate, tz), tz)} · {s._count.entries} lines
                    </p>
                    {s.status === 'RETURNED' && s.returnReason && <p className="t-small mt-1 text-[var(--bad)]">{s.returnReason}</p>}
                  </div>
                  <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
