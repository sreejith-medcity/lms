import { readJson, str } from '@/lib/api/http';
import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { requestLeave } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/teacher/tutoring/leave { fromDay, toDay?, reason? }
 *
 * The tutor asks for leave; it waits for the office. Once approved, seven
 * days or fewer cancels those classes and adds them at the end; more hands
 * the groups to another tutor.
 */
export async function POST(request: Request) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const body = await readJson(request);
  return answer(ctx.tenant, ctx.actor, await requestLeave(ctx.tenant, ctx.actor, { fromDay: str(body?.fromDay, 10), toDay: str(body?.toDay, 10), reason: str(body?.reason, 500) }));
}
