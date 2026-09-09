import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { parseBands } from '@/lib/grading';
import { Card, PageHeader } from '@/components/ui';
import { ScaleCard, NewScale, SeedButton } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Grade scales.
 *
 * A percentage is a measurement; a grade is a judgement. Keeping them apart is
 * why this is configurable at all: 40% is a pass on one exam board and a fail
 * on another, and hard-coding either would make a report card lie.
 */
export default async function GradingSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;

  const scales = await db.gradeScale.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, bands: true, isActive: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grading"
        description="What a score is called. Results, report cards and certificates read whichever scale is in use."
      />

      {scales.length === 0 ? (
        <Card>
          <h2 className="t-heading">No scale yet</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Without one, results show percentages and nothing else, which is fine until somebody
            asks what a B is. Start from the standard seven bands and edit them, or write your own
            below.
          </p>
          {canEdit && (
            <div className="mt-4">
              <SeedButton />
            </div>
          )}
        </Card>
      ) : (
        scales.map((scale) => (
          <ScaleCard
            key={scale.id}
            canEdit={canEdit}
            scale={{
              id: scale.id,
              name: scale.name,
              isActive: scale.isActive,
              bands: parseBands(scale.bands),
            }}
          />
        ))
      )}

      {canEdit && <NewScale />}
    </div>
  );
}
