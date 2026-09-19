import { apiStaff } from '@/lib/api/staff';
import { fail, ok, readJson } from '@/lib/api/http';
import { registerSheet, submitRegisterAs } from '@/lib/register-core';

export const dynamic = 'force-dynamic';

/** GET → the class's register: roster with recorded marks, whether confirmed, and the change history. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await apiStaff(request);
  if (!ctx) return fail('unauthorised', 'Sign in as a member of staff.', 401);
  if (!ctx.user.permissions['scheduling.sessions']?.view) return fail('forbidden', 'You do not have permission to see registers.', 403);
  const { sessionId } = await params;
  const d = await registerSheet(ctx.tenant.organizationId, ctx.tenant.timezone, ctx.user, sessionId);
  if (!d) return fail('not_found', 'Class not found.', 404);
  return ok({
    session: { ...d.session, startsAt: d.session.startsAt.toISOString(), endsAt: d.session.endsAt.toISOString() },
    confirmed: d.confirmed,
    confirmedAt: d.confirmedAt?.toISOString() ?? null,
    confirmedBy: d.confirmedBy,
    started: d.started,
    off: d.off,
    online: d.online,
    confirmedStarted: d.confirmedStarted,
    unrecordedLabel: d.unrecordedLabel,
    canEdit: d.canEdit,
    mayCorrect: d.mayCorrect,
    correctionDays: d.correctionDays,
    marks: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'],
    roster: d.roster,
    history: d.history.map((h) => ({ ...h, at: h.at.toISOString() })),
  });
}

/**
 * POST { marks: [{ userId, status }] } → confirm the register. Only the
 * learners listed are written; anybody left out stays unrecorded. The
 * answer says how many marks were saved and how many parents were told.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await apiStaff(request);
  if (!ctx) return fail('unauthorised', 'Sign in as a member of staff.', 401);
  const { sessionId } = await params;
  const body = await readJson<{ marks?: unknown }>(request);
  const marks = Array.isArray(body?.marks) ? body!.marks.filter((m): m is { userId: string; status: string } => Boolean(m) && typeof m === 'object' && typeof (m as { userId?: unknown }).userId === 'string' && typeof (m as { status?: unknown }).status === 'string') : [];
  if (marks.length === 0) return fail('no_marks', 'Send marks: [{ userId, status }].', 400);
  const res = await submitRegisterAs(ctx.tenant.organizationId, ctx.user, sessionId, marks);
  if (!res.ok) return fail('refused', res.error, res.error === 'Class not found.' ? 404 : 400);
  return ok(res.value);
}
