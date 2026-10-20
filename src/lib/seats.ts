import type { Prisma } from '@prisma/client';

/**
 * Two different questions get asked of a batch's enrolments, and mixing them up
 * makes registers look incomplete or batches look full when they are not.
 *
 * ON_ROLL: who is expected in class. A learner on leave, a registration that has
 * not been confirmed, a cancelled or archived place: none of them is missing
 * from a register.
 *
 * HOLDS_SEAT: who counts against the batch's capacity. A learner on leave or
 * waiting on confirmation still holds a seat; a cancelled or archived place
 * gives it back.
 */
export const ON_ROLL = { status: { in: ['ENROLLED', 'COMPLETED'] } } satisfies Prisma.EnrollmentWhereInput;

export const HOLDS_SEAT = { status: { notIn: ['CANCELLED', 'ARCHIVED'] } } satisfies Prisma.EnrollmentWhereInput;

/** A batch as far as filling it goes: its cap (none means no cap) and the seats held. */
export type BatchRoom = { id: string; capacity: number | null; taken: number };

export function hasRoom(batch: BatchRoom): boolean {
  return !batch.capacity || batch.taken < batch.capacity;
}

/** The first batch, in the order given, that still has a free seat. */
export function firstWithRoom<T extends BatchRoom>(ordered: T[]): T | null {
  return ordered.find(hasRoom) ?? null;
}

/** "3 seats left", "1 seat left", "full", or null when the batch has no cap. */
export function seatsLeftLabel(batch: BatchRoom): string | null {
  if (!batch.capacity) return null;
  const left = Math.max(0, batch.capacity - batch.taken);
  return left === 0 ? 'full' : `${left} seat${left === 1 ? '' : 's'} left`;
}
