import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { deletionWarnings, statusLabel } from '@/lib/data-rights';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { CloseForms } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Requests to be forgotten, and the record of copies taken. A deletion is
 * closed here with the facts in front of the person closing it: what the
 * learner still has, what they still owe, what has been issued to them.
 */
export default async function DataRequestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('learner.learner_management', 'view');
  const canClose = me.permissions['learner.learner_management']?.edit ?? false;
  const canForget = me.permissions['learner.learner_management']?.delete ?? false;
  const { show = 'open' } = await searchParams;

  const requests = await db.dataRequest.findMany({
    where: {
      organizationId: tenant.organizationId,
      ...(show === 'open' ? { status: 'OPEN' } : {}),
      ...(show === 'closed' ? { status: { in: ['DONE', 'REFUSED', 'CANCELLED'] }, kind: 'DELETION' } : {}),
      ...(show === 'exports' ? { kind: 'EXPORT' } : {}),
    },
    orderBy: { createdAt: show === 'open' ? 'asc' : 'desc' },
    take: 200,
    select: {
      id: true,
      kind: true,
      status: true,
      reason: true,
      note: true,
      createdAt: true,
      handledAt: true,
      handledById: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          registrationNo: true,
          _count: {
            select: {
              enrollments: { where: { status: { in: ['ENROLLED', 'ON_LEAVE'] } } },
              certificates: { where: { revokedAt: null } },
              orders: { where: { status: 'PAID' } },
            },
          },
        },
      },
    },
  });

  const openIds = requests.filter((r) => r.status === 'OPEN' && r.kind === 'DELETION').map((r) => r.user.id);
  const unpaid = openIds.length
    ? await db.instalment.groupBy({
        by: ['enrollmentId'],
        where: { paidAt: null, enrollment: { userId: { in: openIds } } },
        _count: { _all: true },
      })
    : [];
  const unpaidByEnrolment = new Map(unpaid.map((u) => [u.enrollmentId, u._count._all]));
  const enrolmentOwners = openIds.length
    ? await db.enrollment.findMany({ where: { organizationId: tenant.organizationId, userId: { in: openIds } }, select: { id: true, userId: true } })
    : [];
  const unpaidByUser = new Map<string, number>();
  for (const e of enrolmentOwners) {
    unpaidByUser.set(e.userId, (unpaidByUser.get(e.userId) ?? 0) + (unpaidByEnrolment.get(e.id) ?? 0));
  }

  const staffIds = Array.from(new Set(requests.map((r) => r.handledById).filter((s): s is string => Boolean(s))));
  const staff = staffIds.length
    ? await db.user.findMany({ where: { id: { in: staffIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })
    : [];
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  const openCount = await db.dataRequest.count({ where: { organizationId: tenant.organizationId, status: 'OPEN' } });

  const tabs = [
    { key: 'open', label: `Waiting${openCount ? ` (${openCount})` : ''}` },
    { key: 'closed', label: 'Closed' },
    { key: 'exports', label: 'Copies taken' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data requests"
        description="Learners asking to be forgotten, and the record of copies of their data they have taken. A closed account keeps its invoices and certificates; the person is taken out of them."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'open' ? '/admin/data-requests' : `/admin/data-requests?show=${t.key}`}
            className="t-small rounded-full border px-3 py-1 font-semibold"
            style={show === t.key ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : undefined}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title={show === 'open' ? 'Nothing waiting' : 'Nothing here'}
          hint="Learners ask from Account, Your data. Requests land here the moment they are sent."
        />
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const warnings =
              r.kind === 'DELETION' && r.status === 'OPEN'
                ? deletionWarnings({
                    activeEnrolments: r.user._count.enrollments,
                    unpaidInstalments: unpaidByUser.get(r.user.id) ?? 0,
                    certificates: r.user._count.certificates,
                    paidOrders: r.user._count.orders,
                  })
                : [];
            return (
              <li key={r.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.kind === 'EXPORT' ? 'neutral' : 'bad'}>{r.kind === 'EXPORT' ? 'Copy taken' : 'Forget me'}</Badge>
                  <Badge tone={r.status === 'OPEN' ? 'warn' : r.status === 'DONE' ? 'ok' : 'neutral'}>{statusLabel(r.status)}</Badge>
                  <span className="t-small faint ml-auto">{formatDateTime(r.createdAt, tenant.timezone)}</span>
                </div>
                <p className="mt-2 text-sm">
                  <Link href={`/admin/learners/${r.user.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {r.user.name}
                  </Link>
                  <span className="faint">
                    {r.user.registrationNo ? ` · ${r.user.registrationNo}` : ''}
                    {r.user.email ? ` · ${r.user.email}` : ''}
                    {r.user.phone ? ` · ${r.user.phone}` : ''}
                  </span>
                </p>
                {r.reason && <p className="mt-2 whitespace-pre-wrap text-sm">&ldquo;{r.reason}&rdquo;</p>}
                {warnings.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-[var(--radius-sm)] p-3" style={{ background: 'var(--warn-soft)' }}>
                    {warnings.map((w) => (
                      <li key={w} className="t-small">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {r.status !== 'OPEN' && r.kind === 'DELETION' && (
                  <p className="t-small muted mt-2">
                    {statusLabel(r.status)}
                    {r.handledById ? ` by ${staffName.get(r.handledById) ?? 'the team'}` : ''}
                    {r.handledAt ? ` · ${formatDateTime(r.handledAt, tenant.timezone)}` : ''}
                    {r.note ? ` · “${r.note}”` : ''}
                  </p>
                )}
                {r.kind === 'DELETION' && r.status === 'OPEN' && (
                  <CloseForms requestId={r.id} learnerName={r.user.name} canRefuse={canClose} canForget={canForget} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
