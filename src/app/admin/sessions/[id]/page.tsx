import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState, Section } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { storageConfigured } from '@/lib/storage';
import { AttendanceRow, CancelSession, Recordings } from './controls';

export const dynamic = 'force-dynamic';

export default async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();

  const session = await db.liveSession.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
          course: { select: { product: { select: { title: true } } } },
          enrollments: {
            where: { status: { in: ['ENROLLED', 'COMPLETED'] } },
            select: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      attendances: true,
      recordings: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, assetId: true, asset: { select: { type: true } } },
      },
    },
  });
  if (!session) notFound();

  const byUser = new Map(session.attendances.map((a) => [a.userId, a]));
  const roster = session.batch.enrollments.map((e) => ({
    user: e.user,
    attendance: byUser.get(e.user.id) ?? null,
  }));

  const present = roster.filter((r) => r.attendance?.status === 'PRESENT').length;
  const late = roster.filter((r) => r.attendance?.status === 'LATE').length;
  const absent = roster.length - present - late;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/sessions" className="t-small muted hover:text-[var(--ink)]">
            Classes
          </Link>
          <h1 className="t-title mt-1 flex items-center gap-3">
            {session.title}
            {session.status === 'CANCELLED' && <Badge tone="bad">cancelled</Badge>}
          </h1>
          <p className="t-small faint mt-1">
            {session.startsAt.toLocaleString('en-IN', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit',
            })}
            {' · '}
            {session.batch.name} · {session.batch.course.product.title}
          </p>
          {session.topics && <p className="t-small muted mt-2 max-w-prose">{session.topics}</p>}
        </div>

        {session.status !== 'CANCELLED' && <CancelSession sessionId={session.id} />}
      </div>

      <StatGrid>
        <Stat label="On the roll" value={roster.length} />
        <Stat label="Present" value={present} />
        <Stat label="Late" value={late} />
        <Stat
          label="Attendance"
          value={roster.length > 0 ? `${Math.round(((present + late) / roster.length) * 100)}%` : '—'}
        />
      </StatGrid>

      <Section title="Attendance">
        {roster.length === 0 ? (
          <EmptyState title="Nobody is enrolled in this batch yet" />
        ) : (
          <Card padded={false}>
            <ul className="divide-y">
              {roster.map((r) => (
                <AttendanceRow
                  key={r.user.id}
                  sessionId={session.id}
                  userId={r.user.id}
                  name={r.user.name}
                  email={r.user.email}
                  status={r.attendance?.status ?? null}
                  joinedAt={r.attendance?.joinedAt ? r.attendance.joinedAt.toISOString() : null}
                />
              ))}
            </ul>
          </Card>
        )}
        <p className="t-small faint">
          Sign-ins are recorded automatically when a learner joins. Use these buttons only for the
          cases the system cannot see.
        </p>
      </Section>

      <Section title="Recording">
        <Recordings
          sessionId={session.id}
          storageReady={storageConfigured()}
          recordings={session.recordings.map((r) => ({
            id: r.id,
            title: r.title,
            assetId: r.assetId,
            type: r.asset.type as string,
          }))}
        />
      </Section>
    </div>
  );
}
