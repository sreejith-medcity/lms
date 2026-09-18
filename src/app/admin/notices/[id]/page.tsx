import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { staffScope } from '@/lib/scope';
import { resolveAudience } from '@/lib/notice-audience';
import { NOTICE_KINDS, audienceLine, meetingLine } from '@/lib/notices';
import { formatDateTime, formatTime } from '@/lib/clock';
import { Badge, Card, PageHeader } from '@/components/ui';
import { NoticeControls } from './controls';
import { STATUS_LABEL, STATUS_TONE } from '../data';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notice', robots: { index: false, follow: false } };

/**
 * One notice: what it says, who it reaches (counted live for a draft, as
 * recorded for a published one), its versions, and the buttons.
 */
export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await requireStaff('announcements.manage_announcements', 'view');
  const scope = await staffScope(user);
  const tz = tenant.timezone;

  const notice = await db.notice.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: { supersedes: { select: { id: true, title: true, version: true, publishedAt: true } }, supersededBy: { select: { id: true, version: true, status: true, publishedAt: true } } },
  });
  if (!notice) notFound();

  const [files, names, createdBy, publishedBy, readCount] = await Promise.all([
    notice.assetIds.length ? db.asset.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.assetIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    Promise.all([
      notice.branchIds.length ? db.branch.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.branchIds } }, select: { name: true } }) : Promise.resolve([]),
      notice.batchIds.length ? db.batch.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.batchIds } }, select: { name: true } }) : Promise.resolve([]),
      notice.learnerIds.length ? db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.learnerIds } }, select: { name: true } }) : Promise.resolve([]),
    ]),
    notice.createdById ? db.user.findFirst({ where: { id: notice.createdById, organizationId: tenant.organizationId }, select: { name: true } }) : Promise.resolve(null),
    notice.publishedById ? db.user.findFirst({ where: { id: notice.publishedById, organizationId: tenant.organizationId }, select: { name: true } }) : Promise.resolve(null),
    notice.status === 'PUBLISHED' ? db.parentNotification.count({ where: { organizationId: tenant.organizationId, noticeId: notice.id, readAt: { not: null } } }) : Promise.resolve(0),
  ]);

  let countLine: string;
  if (notice.status === 'DRAFT') {
    const res = await resolveAudience(tenant.organizationId, scope, notice);
    countLine = res.ok ? audienceLine(res.audience, notice) : res.error;
  } else {
    countLine = `${notice.parentCount} parent${notice.parentCount === 1 ? '' : 's'}${notice.toLearners ? ` and ${notice.learnerCount} learner${notice.learnerCount === 1 ? '' : 's'}` : ''} at publish; ${readCount} parent${readCount === 1 ? '' : 's'} opened it so far.`;
  }

  const audience = notice.everyone ? 'Everyone in the academy' : [...names[0].map((b) => b.name), ...names[1].map((b) => b.name), ...names[2].map((l) => l.name)].join(', ');
  const meeting = meetingLine(notice, (d) => formatDateTime(d, tz), (d) => formatTime(d, tz));
  const superseded = notice.supersededBy.some((v) => v.status === 'PUBLISHED');

  return (
    <div>
      <PageHeader
        title={notice.title}
        description={`${NOTICE_KINDS.find((k) => k.key === notice.kind)?.label ?? notice.kind}${notice.version > 1 ? ` · correction, version ${notice.version}` : ''}`}
        action={
          <Link href="/admin/notices" className="t-small underline">
            All notices
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[notice.status]}>{STATUS_LABEL[notice.status]}</Badge>
              {superseded && <Badge tone="neutral">superseded</Badge>}
            </div>
            {notice.correctionNote && (
              <p className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
                Correction: {notice.correctionNote}
              </p>
            )}
            {meeting && (
              <div className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm">
                <p className="font-medium">{meeting}</p>
                {notice.link && (
                  <a href={notice.link} target="_blank" rel="noreferrer" className="underline">
                    {notice.link}
                  </a>
                )}
                {notice.instructions && <p className="t-small muted mt-1 whitespace-pre-wrap">{notice.instructions}</p>}
              </div>
            )}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{notice.body}</p>
            {files.length > 0 && notice.status !== 'DRAFT' && (
              <ul className="mt-3 space-y-1 border-t pt-3">
                {files.map((f) => (
                  <li key={f.id}>
                    <a href={`/api/assets/${f.id}`} target="_blank" rel="noreferrer" className="t-small underline">
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {notice.status === 'WITHDRAWN' && (
              <p className="t-small mt-3 text-[var(--bad)]">
                Withdrawn {notice.withdrawnAt ? formatDateTime(notice.withdrawnAt, tz) : ''}: {notice.withdrawReason}
              </p>
            )}
          </Card>

          <Card>
            <h2 className="t-heading">Actions</h2>
            <div className="mt-3">
              <NoticeControls id={notice.id} status={notice.status} superseded={superseded} countLine={countLine} files={files} correctionNote={notice.correctionNote ?? ''} isCorrection={notice.supersedesId !== null} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="t-heading">Who gets it</h2>
            <p className="mt-2 text-sm">{audience}</p>
            <p className="t-small faint mt-1">{notice.toParents && notice.toLearners ? 'Parents and learners.' : notice.toLearners ? 'Learners only.' : 'Parents only.'}</p>
            <p className="t-small mt-3">{countLine}</p>
          </Card>

          <Card>
            <h2 className="t-heading">Record</h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="faint">Drafted</dt>
                <dd>
                  {formatDateTime(notice.createdAt, tz)}
                  {createdBy ? ` · ${createdBy.name}` : ''}
                </dd>
              </div>
              {notice.publishedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="faint">Published</dt>
                  <dd>
                    {formatDateTime(notice.publishedAt, tz)}
                    {publishedBy ? ` · ${publishedBy.name}` : ''}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="faint">Version</dt>
                <dd>{notice.version}</dd>
              </div>
            </dl>
            {(notice.supersedes || notice.supersededBy.length > 0) && (
              <ul className="mt-3 space-y-1 border-t pt-3 text-sm">
                {notice.supersedes && (
                  <li>
                    Corrects{' '}
                    <Link href={`/admin/notices/${notice.supersedes.id}`} className="underline">
                      version {notice.supersedes.version}
                    </Link>
                    {notice.supersedes.publishedAt ? `, published ${formatDateTime(notice.supersedes.publishedAt, tz)}` : ''}
                  </li>
                )}
                {notice.supersededBy.map((v) => (
                  <li key={v.id}>
                    {v.status === 'PUBLISHED' ? 'Corrected by' : 'Correction drafted:'}{' '}
                    <Link href={`/admin/notices/${v.id}`} className="underline">
                      version {v.version}
                    </Link>
                    {v.publishedAt ? `, published ${formatDateTime(v.publishedAt, tz)}` : ' (draft)'}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
