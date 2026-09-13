import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { storageConfigured } from '@/lib/storage';
import { formatDateTime } from '@/lib/clock';
import { STATUS_LABEL_STAFF, categoryLabel, statusTone, type HelpStatus } from '@/lib/help-desk';
import { Badge, Card, PageHeader } from '@/components/ui';
import { Thread } from '@/app/learn/help/thread';
import { StaffReplyForm, TicketControls } from '../editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/** One ticket from the office's side: the thread, the learner's context, the reply. */
export default async function StaffTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('learner.learner_management', 'view');
  const canEdit = me.permissions['learner.learner_management']?.edit ?? false;

  const t = await db.helpTicket.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true, subject: true, category: true, status: true, priority: true, assigneeId: true, createdAt: true, enrollmentId: true,
      user: { select: { id: true, name: true, email: true, phone: true, registrationNo: true } },
      branch: { select: { name: true } },
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, fromStaff: true, body: true, attachmentIds: true, createdAt: true, authorId: true } },
    },
  });
  if (!t) notFound();

  const authorIds = Array.from(new Set([...t.messages.map((m) => m.authorId), t.assigneeId].filter((x): x is string => Boolean(x))));
  const assetIds = t.messages.flatMap((m) => m.attachmentIds);
  const [authors, assets, enrolment, openElsewhere] = await Promise.all([
    db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: authorIds } }, select: { id: true, name: true } }),
    assetIds.length ? db.asset.findMany({ where: { organizationId: tenant.organizationId, id: { in: assetIds } }, select: { id: true, fileName: true } }) : Promise.resolve([]),
    t.enrollmentId ? db.enrollment.findFirst({ where: { id: t.enrollmentId, organizationId: tenant.organizationId }, select: { id: true, product: { select: { title: true } }, batch: { select: { name: true } } } }) : Promise.resolve(null),
    db.helpTicket.count({ where: { organizationId: tenant.organizationId, userId: t.user.id, id: { not: t.id }, status: { in: ['OPEN', 'WAITING_ON_LEARNER'] } } }),
  ]);
  const names = new Map(authors.map((a) => [a.id, a.name]));
  const attachments = new Map(assets.map((a) => [a.id, { fileName: a.fileName }]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.subject}
        description={`${categoryLabel(t.category)} · from ${t.user.name}${t.branch ? ` · ${t.branch.name}` : ''} · opened ${formatDateTime(t.createdAt, tenant.timezone)}`}
        action={
          <Link href="/admin/help" className="t-small underline">
            Help desk
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Thread messages={t.messages.map((m) => ({ ...m, authorName: m.authorId ? names.get(m.authorId) ?? null : null }))} timezone={tenant.timezone} viewer="staff" attachments={attachments} />
          {canEdit && (
            <Card>
              <h2 className="t-heading">Reply</h2>
              <div className="mt-3">
                <StaffReplyForm ticketId={t.id} uploads={storageConfigured()} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="t-heading">Status</h2>
              <Badge tone={statusTone(t.status)}>{STATUS_LABEL_STAFF[t.status as HelpStatus] ?? t.status}</Badge>
            </div>
            <p className="t-small muted mt-2">{t.assigneeId ? `With ${names.get(t.assigneeId) ?? 'someone'}.` : 'Nobody has taken it yet.'}{t.priority === 'HIGH' ? ' Marked urgent.' : ''}</p>
            {canEdit && (
              <div className="mt-3">
                <TicketControls id={t.id} status={t.status} priority={t.priority} mine={t.assigneeId === me.id} />
              </div>
            )}
          </Card>

          <Card>
            <h2 className="t-heading">The learner</h2>
            <p className="mt-2 text-sm font-medium">{t.user.name}</p>
            {t.user.registrationNo && <p className="t-small faint">Registration no. {t.user.registrationNo}</p>}
            {t.user.phone && <a href={`tel:${t.user.phone}`} className="t-small block underline">{t.user.phone}</a>}
            {t.user.email && <a href={`mailto:${t.user.email}`} className="t-small block underline">{t.user.email}</a>}
            {enrolment && <p className="t-small mt-2">About {enrolment.product.title}{enrolment.batch ? `, ${enrolment.batch.name}` : ''}</p>}
            {openElsewhere > 0 && <p className="t-small muted mt-2">{openElsewhere} other open ticket{openElsewhere === 1 ? '' : 's'} from them.</p>}
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={`/admin/learners/${t.user.id}`} className="t-small underline">Learner profile</Link>
              {enrolment && <Link href={`/admin/fees/${enrolment.id}`} className="t-small underline">Fee statement</Link>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
