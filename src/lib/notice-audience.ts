import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { canSeeBatch, canSeeBranch, learnerWhere, type StaffScope } from '@/lib/scope';
import { foldAudience, type Audience } from '@/lib/notices';

/**
 * Who a notice reaches, resolved against the database and the sender's
 * scope. The same function runs for the preview and for the publish, so
 * the count the office saw is the count that is sent. A Branch Head's
 * "everyone" is their branch; a batch or branch outside their scope is an
 * error, not a silent drop, because a notice that quietly reached fewer
 * people than the office believes is the worst kind of wrong.
 */

export interface AudienceSpec {
  everyone: boolean;
  branchIds: string[];
  batchIds: string[];
  learnerIds: string[];
}

export type ResolvedAudience = { ok: true; audience: Audience } | { ok: false; error: string };

const LIVE_LEARNER: Prisma.UserWhereInput = { kind: 'LEARNER', status: { in: ['REGISTERED', 'ACTIVE', 'ON_LEAVE'] }, deletedAt: null };
const LIVE_ENROLMENT: Prisma.EnrollmentWhereInput = { status: { in: ['REGISTERED', 'ENROLLED', 'ON_LEAVE'] } };

export async function resolveAudience(organizationId: string, scope: StaffScope, spec: AudienceSpec): Promise<ResolvedAudience> {
  // Everything named must sit inside the sender's scope.
  if (spec.branchIds.length) {
    const branches = await db.branch.findMany({ where: { id: { in: spec.branchIds }, organizationId }, select: { id: true } });
    if (branches.length < spec.branchIds.length) return { ok: false, error: 'One of those branches does not exist.' };
    if (branches.some((b) => !canSeeBranch(scope, b.id))) return { ok: false, error: 'One of those branches is outside what you may reach. Academy-wide notices are sent by Head Office.' };
  }
  if (spec.batchIds.length) {
    const batches = await db.batch.findMany({ where: { id: { in: spec.batchIds }, organizationId, deletedAt: null }, select: { id: true, branchId: true } });
    if (batches.length < spec.batchIds.length) return { ok: false, error: 'One of those batches does not exist.' };
    if (batches.some((b) => !canSeeBatch(scope, b))) return { ok: false, error: 'One of those batches is outside what you may reach.' };
  }
  if (scope.kind === 'batches' && (spec.everyone || spec.branchIds.length)) return { ok: false, error: 'A teacher may not send notices.' };

  const or: Prisma.UserWhereInput[] = [];
  if (spec.everyone) or.push(learnerWhere(scope));
  if (spec.branchIds.length) or.push({ OR: [{ branchMemberships: { some: { branchId: { in: spec.branchIds } } } }, { enrollments: { some: { branchId: { in: spec.branchIds }, ...LIVE_ENROLMENT } } }] });
  if (spec.batchIds.length) or.push({ enrollments: { some: { batchId: { in: spec.batchIds }, ...LIVE_ENROLMENT } } });
  if (spec.learnerIds.length) or.push({ id: { in: spec.learnerIds }, ...learnerWhere(scope) });
  if (or.length === 0) return { ok: true, audience: { learners: [], parents: [] } };

  const rows = await db.user.findMany({
    where: { organizationId, ...LIVE_LEARNER, OR: or },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      branchMemberships: { where: { isPrimary: true }, select: { branchId: true }, take: 1 },
      parentLinks: { where: { status: 'ACTIVE' }, select: { contact: true, name: true } },
    },
    take: 5000,
  });
  if (spec.learnerIds.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = spec.learnerIds.filter((id) => !found.has(id));
    if (missing.length && !spec.everyone && !spec.branchIds.length && !spec.batchIds.length) return { ok: false, error: `${missing.length} of the learners named cannot be reached from your scope or are no longer active.` };
  }

  return {
    ok: true,
    audience: foldAudience(rows.map((r) => ({ id: r.id, name: r.name, branchId: r.branchMemberships[0]?.branchId ?? null, parents: r.parentLinks }))),
  };
}
