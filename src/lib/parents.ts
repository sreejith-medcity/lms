/**
 * The parent portal: what a parent may see of their child, and how the
 * contact on the child's record becomes a way in.
 *
 * No account is created. The phone or email the office wrote down as the
 * parent's is the identity; proving it (a code sent there) opens a read-only
 * view of every learner whose record names that contact.
 */

/** Ten digits for a phone, a lowercased email otherwise; empty when it is neither. */
export function normaliseContact(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function contactProblem(raw: string): string | null {
  if (!raw.trim()) return 'Enter the mobile number or email the academy has for you.';
  if (!normaliseContact(raw)) return 'That does not look like a mobile number or an email address.';
  return null;
}

/** "the number ending 4471" or "sr***@miak.in", so the screen never prints the whole thing. */
export function maskContact(contact: string): string {
  if (contact.includes('@')) {
    const [name, domain] = contact.split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  return `the number ending ${contact.slice(-4)}`;
}

export interface AttendanceRow {
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | string;
  startsAt: Date;
}

export interface AttendanceSummary {
  held: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Present or late, over held less excused. Null when nothing was held. */
  percent: number | null;
  /** Classes missed in a row, counted back from the latest. */
  streakMissed: number;
}

export function summariseAttendance(rows: AttendanceRow[]): AttendanceSummary {
  const out: AttendanceSummary = { held: 0, present: 0, late: 0, absent: 0, excused: 0, percent: null, streakMissed: 0 };
  for (const r of rows) {
    out.held += 1;
    if (r.status === 'PRESENT') out.present += 1;
    else if (r.status === 'LATE') out.late += 1;
    else if (r.status === 'EXCUSED') out.excused += 1;
    else out.absent += 1;
  }
  const counted = out.held - out.excused;
  out.percent = counted > 0 ? Math.round(((out.present + out.late) / counted) * 100) : null;
  const latestFirst = [...rows].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  for (const r of latestFirst) {
    if (r.status === 'ABSENT') out.streakMissed += 1;
    else if (r.status === 'EXCUSED') continue;
    else break;
  }
  return out;
}

/** One sentence a parent can act on. */
export function attendanceNote(s: AttendanceSummary): string {
  if (s.held === 0) return 'No classes held yet.';
  if (s.streakMissed >= 3) return `Missed the last ${s.streakMissed} classes.`;
  if (s.percent !== null && s.percent < 75) return `Attendance is ${s.percent}%, below the 75% most academies expect.`;
  if (s.percent !== null && s.percent >= 90) return `Attendance is ${s.percent}%. Regular.`;
  return `Attendance is ${s.percent ?? 0}%.`;
}

export interface MarkRow {
  title: string;
  scorePercent: number | null;
  passed: boolean | null;
  submittedAt: Date | null;
}

/** Average of the marked papers, and how many passed. */
export function summariseMarks(rows: MarkRow[]): { marked: number; average: number | null; passed: number } {
  const marked = rows.filter((r) => r.scorePercent !== null);
  const average = marked.length ? Math.round(marked.reduce((n, r) => n + (r.scorePercent ?? 0), 0) / marked.length) : null;
  return { marked: marked.length, average, passed: rows.filter((r) => r.passed === true).length };
}
