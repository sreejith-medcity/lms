import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { parentInboxRows } from '@/lib/parent-inbox-data';

export const dynamic = 'force-dynamic';

/** GET → the inbox: notices, attendance alerts, results and fee reminders across the children, unread first. */
export async function GET(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { rows, unread } = await parentInboxRows(ctx.tenant.organizationId, ctx.parent.contact);
  return ok({ unread, rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
}
