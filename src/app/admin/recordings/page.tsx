import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatBytes } from '@/lib/storage';
import { formatDayLabel, dayKey, formatTime } from '@/lib/clock';
import { EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { RecordingsTable, Filters } from './table';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Every recording, in one place.
 *
 * Recordings are made per class but decided on in batches: a term is recorded,
 * then someone goes through and says which of it learners should keep. That
 * review is a list with checkboxes, not thirty session pages.
 */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; state?: string; q?: string }>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const me = await requireStaff('class_recording.publish_recordings', 'view');
  const canEdit = me.permissions['class_recording.publish_recordings']?.edit ?? false;
  const tz = tenant.timezone;

  const batchId = params.batch || '';
  const state = params.state === 'published' || params.state === 'hidden' ? params.state : '';
  const query = (params.q || '').trim();

  const [rows, batches, totals] = await Promise.all([
    db.recording.findMany({
      where: {
        session: {
          organizationId: tenant.organizationId,
          ...(batchId ? { batchId } : {}),
        },
        ...(state ? { isPublished: state === 'published' } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' as const } },
                { session: { title: { contains: query, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: { session: { startsAt: 'desc' } },
      take: 200,
      select: {
        id: true,
        title: true,
        isPublished: true,
        assetId: true,
        asset: { select: { sizeBytes: true, durationSeconds: true, type: true } },
        session: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            batch: { select: { id: true, name: true, _count: { select: { enrollments: true } } } },
          },
        },
      },
    }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.recording.groupBy({
      by: ['isPublished'],
      where: { session: { organizationId: tenant.organizationId } },
      _count: true,
    }),
  ]);

  const published = totals.find((t) => t.isPublished)?._count ?? 0;
  const hidden = totals.find((t) => !t.isPublished)?._count ?? 0;
  const bytes = rows.reduce((n, r) => n + Number(r.asset.sizeBytes ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recordings"
        description="Every class recording across every batch, with the ones nobody has released yet sitting at the top of the pile."
      />

      <StatGrid>
        <Stat label="Published" value={published} sub="visible to learners" />
        <Stat label="Held back" value={hidden} sub={hidden > 0 ? 'nobody can see these' : 'nothing waiting'} />
        <Stat label="In view" value={rows.length} sub={`${formatBytes(bytes)} of media`} />
        <Stat label="Batches" value={batches.length} />
      </StatGrid>

      <Filters batchId={batchId} state={state} query={query} batches={batches} />

      {rows.length === 0 ? (
        <EmptyState
          title="No recordings match"
          hint="Recordings are attached to a class from its own page, then reviewed here."
        />
      ) : (
        <RecordingsTable
          canEdit={canEdit}
          rows={rows.map((r) => ({
            id: r.id,
            title: r.title,
            isPublished: r.isPublished,
            assetId: r.assetId,
            sizeLabel: r.asset.sizeBytes ? formatBytes(Number(r.asset.sizeBytes)) : null,
            durationLabel: r.asset.durationSeconds
              ? `${Math.round(r.asset.durationSeconds / 60)} min`
              : null,
            sessionId: r.session.id,
            sessionTitle: r.session.title,
            batchName: r.session.batch?.name ?? 'One to one',
            roster: r.session.batch?._count.enrollments ?? 1,
            when: `${formatDayLabel(dayKey(r.session.startsAt, tz), tz)}, ${formatTime(r.session.startsAt, tz)}`,
          }))}
        />
      )}
    </div>
  );
}
