import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { ProgramCard, ProgramForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Programs.
 *
 * German runs A1 to B2 across four skills with a pass mark; NCLEX runs
 * modules with one score and no levels. Writing that shape down once, above
 * the course, is what lets a batch name its level, a mark sheet offer the
 * right kinds of test, and a parent's progress view compare like with like.
 */
export default async function ProgramsSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;

  const [programs, scales] = await Promise.all([
    db.program.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        levels: true,
        skills: true,
        assessmentCategories: true,
        passPercent: true,
        gradeScaleId: true,
        retestRule: true,
        ratingRubric: true,
        isActive: true,
        _count: { select: { courses: true } },
      },
    }),
    db.gradeScale.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programs"
        description="The shape above a course: its levels or modules, the skills it assesses, the kinds of test a teacher may set, and what counts as a pass. A course belongs to one program; a batch names the level it teaches."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {programs.length === 0 ? (
            <Card>
              <h2 className="t-heading">No program yet</h2>
              <p className="t-small muted mt-1 max-w-prose">
                Courses work without one: a batch&rsquo;s level is free text and a teacher may set
                any of the seven standard kinds of test. Add a program when the office wants
                levels, skills and a pass mark to mean the same thing across every batch of it.
              </p>
            </Card>
          ) : (
            programs.map((p) => (
              <ProgramCard
                key={p.id}
                canEdit={canEdit}
                scales={scales}
                program={{
                  id: p.id,
                  name: p.name,
                  code: p.code,
                  description: p.description,
                  levels: p.levels,
                  skills: p.skills,
                  categories: p.assessmentCategories,
                  passPercent: p.passPercent,
                  gradeScaleId: p.gradeScaleId,
                  retestRule: p.retestRule,
                  hasRubric: p.ratingRubric !== null,
                  isActive: p.isActive,
                  courses: p._count.courses,
                }}
              />
            ))
          )}
        </div>
        {canEdit && (
          <Card>
            <h2 className="t-heading">Add a program</h2>
            <p className="t-small muted mt-1">Levels, skills and kinds of test as a comma-separated list, in order.</p>
            <div className="mt-5">
              <ProgramForm scales={scales} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
