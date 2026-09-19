import { apiStaff } from '@/lib/api/staff';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { correctAttendanceAs } from '@/lib/register-core';

export const dynamic = 'force-dynamic';

/** POST { userId, status, reason } → change a confirmed mark. The reason is kept and reaches the parent if an alert went out. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await apiStaff(request);
  if (!ctx) return fail('unauthorised', 'Sign in as a member of staff.', 401);
  const { sessionId } = await params;
  const body = await readJson(request);
  const userId = str(body?.userId, 100);
  const status = str(body?.status, 20).toUpperCase();
  const reason = str(body?.reason, 300);
  if (!userId || !status) return fail('bad_request', 'Send userId, status and reason.', 400);
  const res = await correctAttendanceAs(ctx.tenant.organizationId, ctx.user, sessionId, userId, status, reason);
  if (!res.ok) return fail('refused', res.error, res.error === 'Class not found.' ? 404 : 400);
  return ok(res.value);
}
