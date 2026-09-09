import Link from 'next/link';
import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import {
  Badge, Button, Cell, EmptyState, Input, PageHeader, ProgressRing, Row, Table,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

const TABS: { label: string; status?: $Enums.UserStatus }[] = [
  { label: 'All' },
  { label: 'Registered', status: 'REGISTERED' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Archived', status: 'ARCHIVED' },
];

export default async function LearnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const tenant = await requireTenant();
  const { q, status } = await searchParams;

  const learners = await db.user.findMany({
    where: {
      organizationId: tenant.organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      ...(status ? { status: status as $Enums.UserStatus } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { enrollments: true } },
      enrollments: { select: { progressPercent: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div>
      <PageHeader
        title="Learners"
        description="Everyone enrolled or registered with the academy."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => {
          const active = (status ?? '') === (t.status ?? '');
          const href = t.status ? `/admin/learners?status=${t.status}` : '/admin/learners';
          return (
            <a
              key={t.label}
              href={href}
              className={`rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition ${
                active
                  ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'muted hover:bg-[var(--surface-2)]'
              }`}
            >
              {t.label}
            </a>
          );
        })}

        <form className="ml-auto flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <Input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, email or phone"
            className="w-64"
          />
          <Button variant="secondary" type="submit">
            Search
          </Button>
        </form>
      </div>

      {learners.length === 0 ? (
        <EmptyState
          title="No learners match"
          hint={q ? 'Try a different search.' : 'Learners appear here once they sign up or are enrolled.'}
        />
      ) : (
        <Table head={['Learner', 'Contact', 'Status', 'Reg. no', 'Courses', 'Progress']}>
          {learners.map((l) => {
            const avg =
              l.enrollments.length > 0
                ? l.enrollments.reduce((n, e) => n + e.progressPercent, 0) / l.enrollments.length
                : 0;

            return (
              <Row key={l.id}>
                <Cell>
                  <Link href={`/admin/learners/${l.id}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                </Cell>
                <Cell>
                  <span className="t-small block">{l.email}</span>
                  {l.phone && <span className="t-small faint block">{l.phone}</span>}
                </Cell>
                <Cell>
                  <Badge tone={l.status === 'ACTIVE' ? 'ok' : l.status === 'ARCHIVED' ? 'neutral' : 'brand'}>
                    {l.status.toLowerCase().replace('_', ' ')}
                  </Badge>
                </Cell>
                <Cell className="tabular-nums">{l.registrationNo ?? '—'}</Cell>
                <Cell className="tabular-nums">{l._count.enrollments}</Cell>
                <Cell>{l.enrollments.length > 0 ? <ProgressRing value={avg} size={34} /> : <span className="faint">—</span>}</Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
