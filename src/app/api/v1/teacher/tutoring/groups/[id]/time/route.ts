import { readJson, str } from '@/lib/api/http';
import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { moveGroupTime } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/teacher/tutoring/groups/:id/time { time: "HH:MM", fromDay, onwards?: boolean }
 *
 * The group's tutor moves a class: that day only, or every class from that
 * day on. Refused when the tutor has another online class then. The
 * learners are told at once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const { id } = await params;
  const body = await readJson(request);
  return answer(ctx.tenant, ctx.actor, await moveGroupTime(ctx.tenant, ctx.actor, { groupId: id, time: str(body?.time, 5), fromDay: str(body?.fromDay, 10), onlyThatDay: body?.onwards !== true }));
}
