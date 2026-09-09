import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Classroom } from './classroom';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The classroom.
 *
 * Everything about one batch on one screen, because the questions a batch
 * manager asks are all about the same twenty people: who is in it, is it being
 * taught, are they turning up, are they getting through the material, and are
 * they passing anything. Splitting that across five pages is how the incumbent
 * makes a simple question take four clicks.
 */
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('batches.batch_management', 'view');
  const canEdit = me.permissions['batches.batch_management']?.edit ?? false;

  const batch = await db.batch.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      capacity: true,
      isDefault: true,
      progressPercent: true,
      branch: { select: { name: true } },
      course: {
        select: {
          id: true,
          product: { select: { id: true, title: true } },
          modules: {
            orderBy: { sortOrder: 'asc' },
            select: {
              module: {
                select: {
                  id: true,
                  name: true,
                  sections: { select: { materials: { select: { id: true } } } },
                },
              },
            },
          },
        },
      },
      modules: { select: { moduleId: true } },
      staff: true,
      sessions: {
        orderBy: { startsAt: 'desc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          status: true,
          attendances: { select: { userId: true, status: true } },
        },
      },
      enrollments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          progressPercent: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
  });
  if (!batch) notFound();

  const team = await db.user.findMany({
    where: { organizationId: tenant.organizationId, kind: 'STAFF', deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const learnerIds = batch.enrollments.map((e) => e.user.id);

  const attempts = learnerIds.length
    ? await db.attempt.findMany({
        where: {
          userId: { in: learnerIds },
          status: 'EVALUATED',
          assessment: { courses: { some: { courseId: batch.course.id } } },
        },
        select: { userId: true, scorePercent: true, passed: true },
      })
    : [];

  const held = batch.sessions.filter(
    (s) => s.status !== 'CANCELLED' && s.startsAt <= new Date(),
  );
  const cancelled = batch.sessions.filter((s) => s.status === 'CANCELLED').length;

  const signIns = held.reduce(
    (n, s) => n + s.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length,
    0,
  );
  const late = held.reduce((n, s) => n + s.attendances.filter((a) => a.status === 'LATE').length, 0);
  const expected = held.length * batch.enrollments.length;

  const attendedBy = new Map<string, number>();
  for (const s of held) {
    for (const a of s.attendances) {
      if (a.status === 'PRESENT' || a.status === 'LATE') {
        attendedBy.set(a.userId, (attendedBy.get(a.userId) ?? 0) + 1);
      }
    }
  }

  const scoresBy = new Map<string, { average: number; passed: number; taken: number }>();
  for (const a of attempts) {
    const entry = scoresBy.get(a.userId) ?? { average: 0, passed: 0, taken: 0 };
    entry.average = (entry.average * entry.taken + (a.scorePercent ?? 0)) / (entry.taken + 1);
    entry.taken += 1;
    if (a.passed) entry.passed += 1;
    scoresBy.set(a.userId, entry);
  }

  const totalLessons = batch.course.modules.reduce(
    (n, cm) => n + cm.module.sections.reduce((s, sec) => s + sec.materials.length, 0),
    0,
  );

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/batches" className="t-small faint hover:underline">
          Batches
        </Link>
        <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
          {batch.name}
          <Badge tone={batch.status === 'ACTIVE' ? 'ok' : 'neutral'}>
            {batch.status.toLowerCase()}
          </Badge>
          {batch.isDefault && <Badge tone="brand">default</Badge>}
        </h1>
        <p className="t-small faint mt-1">
          <Link href={`/admin/courses/${batch.course.product.id}`} className="hover:underline">
            {batch.course.product.title}
          </Link>
          {' · '}
          {batch.branch.name}
          {batch.startDate
            ? ` · ${batch.startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : ''}
          {batch.endDate
            ? ` to ${batch.endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : ''}
        </p>
      </div>

      <div className="mb-6">
        <StatGrid>
          <Stat
            label="Learners"
            value={String(batch.enrollments.length)}
            sub={batch.capacity ? `of ${batch.capacity} seats` : 'no cap'}
          />
          <Stat
            label="Classes held"
            value={String(held.length)}
            sub={`${batch.sessions.length - held.length - cancelled} to come · ${cancelled} cancelled`}
          />
          <Stat
            label="Attendance"
            value={expected > 0 ? `${Math.round((signIns / expected) * 100)}%` : '—'}
            sub={expected > 0 ? `${signIns} of ${expected} expected` : 'no classes yet'}
          />
          <Stat
            label="On time"
            value={signIns > 0 ? `${Math.round(((signIns - late) / signIns) * 100)}%` : '—'}
            sub={late > 0 ? `${late} joined late` : 'of those who came'}
          />
        </StatGrid>
      </div>

      <Classroom
        canEdit={canEdit}
        batch={{
          id: batch.id,
          name: batch.name,
          startDate: batch.startDate?.toISOString().slice(0, 10) ?? '',
          endDate: batch.endDate?.toISOString().slice(0, 10) ?? '',
          capacity: batch.capacity ?? 0,
          isDefault: batch.isDefault,
        }}
        learners={batch.enrollments.map((e) => {
          const came = attendedBy.get(e.user.id) ?? 0;
          const scores = scoresBy.get(e.user.id);
          return {
            enrollmentId: e.id,
            userId: e.user.id,
            name: e.user.name,
            contact: e.user.email ?? e.user.phone ?? '',
            status: e.status,
            progress: Math.round(e.progressPercent),
            attended: came,
            attendanceRate: held.length > 0 ? Math.round((came / held.length) * 100) : null,
            averageScore: scores ? Math.round(scores.average) : null,
            assessmentsTaken: scores?.taken ?? 0,
            assessmentsPassed: scores?.passed ?? 0,
            joinedAt: e.createdAt.toISOString(),
          };
        })}
        sessions={batch.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          startsAt: s.startsAt.toISOString(),
          status: s.status,
          present: s.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length,
          late: s.attendances.filter((a) => a.status === 'LATE').length,
        }))}
        roster={batch.enrollments.length}
        totalLessons={totalLessons}
        courseModules={batch.course.modules.map((cm) => ({
          id: cm.module.id,
          name: cm.module.name,
          lessons: cm.module.sections.reduce((n, s) => n + s.materials.length, 0),
        }))}
        selectedModules={batch.modules.map((m) => m.moduleId)}
        staff={batch.staff.map((s) => ({ userId: s.userId, role: s.role }))}
        team={team}
      />
    </div>
  );
}
