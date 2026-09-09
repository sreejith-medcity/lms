import { db } from '@/lib/db';
import { isLocked, type DripRule } from '@/lib/drip';

/**
 * What this learner is allowed to see, and when.
 *
 * Three things narrow a course down to one learner's view of it: the batch may
 * teach only part of the curriculum, sections may be hidden while they are
 * still being written, and lessons may be dripped. The learner pages all need
 * the same answer, so it is computed once here rather than three times badly.
 *
 * A locked lesson is still listed. Hiding it would leave the learner unable to
 * tell a short course from a course they cannot see all of, and "opens on the
 * 12th" is the answer they actually want.
 */
export interface CurriculumGate {
  /** Module ids the batch teaches, or null when it teaches the whole course. */
  moduleIds: Set<string> | null;
  /** Null when the lesson is open. */
  lockOf(materialId: string, sectionId: string): { until: Date; label: string } | null;
  teaches(moduleId: string): boolean;
}

function label(until: Date) {
  const today = new Date();
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((until.getTime() - midnight.getTime()) / 86_400_000);

  if (days <= 1) return 'Opens tomorrow';
  if (days <= 7) return `Opens in ${days} days`;
  return `Opens ${until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export async function curriculumGate(opts: {
  courseId: string;
  enrolledAt: Date | null;
  batchId: string | null;
}): Promise<CurriculumGate> {
  const [batch, rules] = await Promise.all([
    opts.batchId
      ? db.batch.findUnique({
          where: { id: opts.batchId },
          select: { startDate: true, modules: { select: { moduleId: true } } },
        })
      : null,
    db.dripRule.findMany({
      where: { courseId: opts.courseId },
      select: { materialId: true, sectionId: true, anchor: true, offsetDays: true, releaseAt: true },
    }),
  ]);

  const context = { enrolledAt: opts.enrolledAt, batchStartsAt: batch?.startDate ?? null };

  const byMaterial = new Map<string, DripRule>();
  const bySection = new Map<string, DripRule>();
  for (const r of rules) {
    const rule: DripRule = {
      materialId: r.materialId,
      anchor: r.anchor,
      offsetDays: r.offsetDays,
      releaseAt: r.releaseAt,
    };
    if (r.materialId) byMaterial.set(r.materialId, rule);
    else if (r.sectionId) bySection.set(r.sectionId, rule);
  }

  const moduleIds =
    batch && batch.modules.length > 0 ? new Set(batch.modules.map((m) => m.moduleId)) : null;

  return {
    moduleIds,
    teaches: (moduleId: string) => !moduleIds || moduleIds.has(moduleId),
    lockOf(materialId: string, sectionId: string) {
      // The lesson's own rule wins; the section's rule covers the rest of it.
      const until =
        isLocked(byMaterial.get(materialId), context) ?? isLocked(bySection.get(sectionId), context);
      return until ? { until, label: label(until) } : null;
    },
  };
}
