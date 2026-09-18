import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { activeStaffWhere } from '@/lib/scope-rules';

/**
 * What a member of staff may see, decided once per request and applied in
 * queries rather than by hiding menus.
 *
 * Three shapes. "Everything" is an explicit grant: a role without either
 * restriction. "Branches" is a Branch Head or an Academic Manager: the
 * branches they are a member of, and everything that belongs to those
 * branches. "Batches" is a teacher: the batches they are assigned to today,
 * by the dates on the assignment, and the learners enrolled in them. A
 * teacher assigned across branches sees those batches and no others in
 * either branch, which is the rule the requirements draft insists on.
 *
 * Every helper here returns a Prisma `where` fragment to spread into an
 * existing query, so a page that already names the academy adds one line
 * and cannot forget the scope on a second query further down.
 */

export type StaffScope =
  | { kind: 'all' }
  | { kind: 'branches'; branchIds: string[] }
  | { kind: 'batches'; batchIds: string[]; branchIds: string[] };

/** Head Office looking at one branch: a cookie, honoured only for a scope that is otherwise the whole academy. */
export const BRANCH_VIEW_COOKIE = 'mlms_branch';

export const staffScope = cache(async (user: SessionUser): Promise<StaffScope> => {
  if (user.restrictBatchAccess) {
    const rows = await db.batchStaff.findMany({
      where: { userId: user.id, batch: { organizationId: user.organizationId, deletedAt: null }, ...activeStaffWhere(new Date()) },
      select: { batchId: true, batch: { select: { branchId: true } } },
    });
    return {
      kind: 'batches',
      batchIds: Array.from(new Set(rows.map((r) => r.batchId))),
      branchIds: Array.from(new Set(rows.map((r) => r.batch.branchId))),
    };
  }
  if (user.restrictBranchAccess) return { kind: 'branches', branchIds: user.branchIds };
  // The branch switcher narrows an academy-wide view to one branch for a
  // while. It never widens anybody: a Branch Head's cookie is ignored.
  const viewing = (await cookies()).get(BRANCH_VIEW_COOKIE)?.value;
  if (viewing) {
    const branch = await db.branch.findFirst({ where: { id: viewing, organizationId: user.organizationId }, select: { id: true } });
    if (branch) return { kind: 'branches', branchIds: [branch.id] };
  }
  return { kind: 'all' };
});

/** Whether this person could switch branches at all: their own scope is the academy. */
export function canSwitchBranch(user: SessionUser): boolean {
  return !user.restrictBatchAccess && !user.restrictBranchAccess;
}

/** True when the scope is not the whole academy. */
export function isScoped(scope: StaffScope): boolean {
  return scope.kind !== 'all';
}

/** A short sentence for a page header: what this person is looking at. */
export function scopeNote(scope: StaffScope): string | null {
  if (scope.kind === 'branches') return scope.branchIds.length === 1 ? 'Your branch only.' : `Your ${scope.branchIds.length} branches only.`;
  if (scope.kind === 'batches') return scope.batchIds.length === 0 ? 'No batch is assigned to you.' : scope.batchIds.length === 1 ? 'Your batch only.' : `Your ${scope.batchIds.length} batches only.`;
  return null;
}

export function batchWhere(scope: StaffScope): Prisma.BatchWhereInput {
  if (scope.kind === 'branches') return { branchId: { in: scope.branchIds } };
  if (scope.kind === 'batches') return { id: { in: scope.batchIds } };
  return {};
}

export function branchWhere(scope: StaffScope): Prisma.BranchWhereInput {
  if (scope.kind === 'all') return {};
  return { id: { in: scope.branchIds } };
}

/** Learners: enrolled in a batch of the scope, or a member of one of its branches. */
export function learnerWhere(scope: StaffScope): Prisma.UserWhereInput {
  if (scope.kind === 'branches') {
    return {
      OR: [
        { branchMemberships: { some: { branchId: { in: scope.branchIds } } } },
        { enrollments: { some: { branchId: { in: scope.branchIds } } } },
      ],
    };
  }
  if (scope.kind === 'batches') return { enrollments: { some: { batchId: { in: scope.batchIds } } } };
  return {};
}

export function enrollmentWhere(scope: StaffScope): Prisma.EnrollmentWhereInput {
  if (scope.kind === 'branches') return { branchId: { in: scope.branchIds } };
  if (scope.kind === 'batches') return { batchId: { in: scope.batchIds } };
  return {};
}

/** Classes: a batch's class inside the scope, or a one-to-one class with a learner in it. */
export function sessionWhere(scope: StaffScope): Prisma.LiveSessionWhereInput {
  if (scope.kind === 'branches') {
    return {
      OR: [
        { batch: { branchId: { in: scope.branchIds } } },
        { learner: { enrollments: { some: { branchId: { in: scope.branchIds } } } } },
      ],
    };
  }
  if (scope.kind === 'batches') return { batchId: { in: scope.batchIds } };
  return {};
}

export function orderWhere(scope: StaffScope): Prisma.OrderWhereInput {
  if (scope.kind === 'branches') return { branchId: { in: scope.branchIds } };
  // A teacher's scope has no money in it; the permission matrix keeps them
  // off these screens, and this makes a slip there return nothing.
  if (scope.kind === 'batches') return { id: { in: [] } };
  return {};
}

export function paymentWhere(scope: StaffScope): Prisma.PaymentWhereInput {
  if (scope.kind === 'branches') return { order: { branchId: { in: scope.branchIds } } };
  if (scope.kind === 'batches') return { id: { in: [] } };
  return {};
}

export function announcementWhere(scope: StaffScope): Prisma.AnnouncementWhereInput {
  if (scope.kind === 'branches') return { targets: { some: { batch: { branchId: { in: scope.branchIds } } } } };
  if (scope.kind === 'batches') return { targets: { some: { batchId: { in: scope.batchIds } } } };
  return {};
}

export function canSeeBatch(scope: StaffScope, batch: { id: string; branchId: string }): boolean {
  if (scope.kind === 'branches') return scope.branchIds.includes(batch.branchId);
  if (scope.kind === 'batches') return scope.batchIds.includes(batch.id);
  return true;
}

export function canSeeBranch(scope: StaffScope, branchId: string): boolean {
  if (scope.kind === 'all') return true;
  return scope.branchIds.includes(branchId);
}

/** Whether this learner is inside the scope, by the same rule `learnerWhere` applies. */
export async function canSeeLearner(scope: StaffScope, organizationId: string, learnerId: string): Promise<boolean> {
  if (scope.kind === 'all') return true;
  const hit = await db.user.findFirst({ where: { id: learnerId, organizationId, ...learnerWhere(scope) }, select: { id: true } });
  return hit !== null;
}
