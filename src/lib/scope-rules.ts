/**
 * The pure rules behind staff scope and teacher assignments: no database,
 * so the tests can say exactly when an assignment counts and when it does
 * not.
 */

export interface AssignmentDates {
  startsOn: Date | null;
  endsOn: Date | null;
}

export type AssignmentState = 'upcoming' | 'active' | 'ended';

/** Midnight at the start of the day, in UTC, which is how the dates are stored. */
export function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * An assignment is active from its start date (inclusive) to its end date
 * (inclusive); either side open when null. The end date is a day, so an
 * assignment that ends "today" still counts today and stops tomorrow.
 */
export function assignmentState(a: AssignmentDates, today: Date): AssignmentState {
  const day = dayStart(today).getTime();
  if (a.startsOn && dayStart(a.startsOn).getTime() > day) return 'upcoming';
  if (a.endsOn && dayStart(a.endsOn).getTime() < day) return 'ended';
  return 'active';
}

/** The Prisma fragment that says the same thing as `assignmentState(...) === 'active'`. */
export function activeStaffWhere(today: Date) {
  const day = dayStart(today);
  return {
    AND: [
      { OR: [{ startsOn: null }, { startsOn: { lte: day } }] },
      { OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
    ],
  };
}

export interface ImpactInput {
  /** Rows on the batch today, before the change. */
  current: { userId: string; role: string; startsOn: Date | null; endsOn: Date | null }[];
  change: { userId: string; role: string; startsOn: Date | null; endsOn: Date | null } | { end: { userId: string; role: string; endsOn: Date } };
  today: Date;
}

/**
 * What an assignment change does to who can see the batch, in words the
 * Branch Head reads before pressing save. Ends are read against today: an
 * end date in the past removes access now, one in the future removes it
 * then.
 */
export function assignmentImpact(input: ImpactInput, nameOf: (userId: string) => string): string[] {
  const lines: string[] = [];
  const { change, today } = input;
  if ('end' in change) {
    const state = assignmentState({ startsOn: null, endsOn: change.end.endsOn }, today);
    lines.push(
      state === 'ended'
        ? `${nameOf(change.end.userId)} loses access to this batch now; their marks and registers stay.`
        : `${nameOf(change.end.userId)} keeps access until ${change.end.endsOn.toISOString().slice(0, 10)}, then loses it; their marks and registers stay.`,
    );
    return lines;
  }
  const state = assignmentState(change, today);
  const already = input.current.find((c) => c.userId === change.userId && c.role === change.role);
  if (state === 'active') lines.push(`${nameOf(change.userId)} can see this batch, its learners and its academic history from now.`);
  else if (state === 'upcoming') lines.push(`${nameOf(change.userId)} gets access on ${change.startsOn!.toISOString().slice(0, 10)}.`);
  else lines.push(`${nameOf(change.userId)} gets no access: the dates are already past.`);
  if (already) lines.push('This replaces their current dates on the batch.');
  const others = input.current.filter((c) => c.role === change.role && c.userId !== change.userId && assignmentState(c, today) === 'active');
  if (change.role === 'PRIMARY_TUTOR' && others.length) {
    lines.push(`${others.map((o) => nameOf(o.userId)).join(', ')} ${others.length === 1 ? 'stays' : 'stay'} on the batch too; end their assignment if this is a replacement.`);
  }
  lines.push('Fees are never part of a teacher’s access.');
  return lines;
}

/** Ten digits, or a lowercased email; null when the record holds neither. */
export function contactFromRecord(profile: { parentPhone: string | null; parentEmail: string | null } | null): { contact: string; kind: 'phone' | 'email' }[] {
  const out: { contact: string; kind: 'phone' | 'email' }[] = [];
  if (!profile) return out;
  const digits = (profile.parentPhone ?? '').replace(/\D/g, '');
  if (digits.length >= 10) out.push({ contact: digits.slice(-10), kind: 'phone' });
  const email = (profile.parentEmail ?? '').trim().toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push({ contact: email, kind: 'email' });
  return out;
}
