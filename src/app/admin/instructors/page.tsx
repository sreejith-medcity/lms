import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { EmptyState, PageHeader } from '@/components/ui';
import { InstructorCard } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Who teaches, as the public sees them.
 *
 * Only staff who are actually assigned to a batch appear, because a profile for
 * somebody who never teaches is a page nobody will ever reach.
 */
export default async function InstructorsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('instructor.instructor_management', 'view');
  const canEdit = me.permissions['instructor.instructor_management']?.edit ?? false;

  const assignments = await db.batchStaff.findMany({
    where: { batch: { organizationId: tenant.organizationId, deletedAt: null } },
    select: { userId: true, role: true, batch: { select: { name: true } } },
  });

  const teaching = new Map<string, { batches: string[]; roles: Set<string> }>();
  for (const a of assignments) {
    const entry = teaching.get(a.userId) ?? { batches: [], roles: new Set<string>() };
    entry.batches.push(a.batch.name);
    entry.roles.add(a.role);
    teaching.set(a.userId, entry);
  }

  const team = await db.user.findMany({
    where: {
      organizationId: tenant.organizationId,
      kind: 'STAFF',
      deletedAt: null,
      ...(teaching.size > 0 ? {} : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      instructorProfile: {
        select: {
          headline: true,
          bio: true,
          expertise: true,
          hourlyRatePaise: true,
          isMentor: true,
          hideNameOnCards: true,
        },
      },
    },
  });

  const withTeaching = team
    .map((t) => ({ ...t, teaching: teaching.get(t.id) }))
    .sort((a, b) => (b.teaching ? 1 : 0) - (a.teaching ? 1 : 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instructors"
        description="What the public course page says about whoever teaches it. A name on its own makes a course look unstaffed."
      />

      {withTeaching.length === 0 ? (
        <EmptyState title="No staff accounts yet" hint="Add people under Team first." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {withTeaching.map((t) => (
            <InstructorCard
              key={t.id}
              canEdit={canEdit}
              currency={tenant.currency}
              instructor={{
                id: t.id,
                name: t.name,
                email: t.email,
                headline: t.instructorProfile?.headline ?? '',
                bio: t.instructorProfile?.bio ?? '',
                expertise: (t.instructorProfile?.expertise ?? []).join(', '),
                hourlyRateRupees: t.instructorProfile?.hourlyRatePaise
                  ? t.instructorProfile.hourlyRatePaise / 100
                  : 0,
                isMentor: t.instructorProfile?.isMentor ?? false,
                hideNameOnCards: t.instructorProfile?.hideNameOnCards ?? false,
                batches: t.teaching ? [...new Set(t.teaching.batches)] : [],
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
