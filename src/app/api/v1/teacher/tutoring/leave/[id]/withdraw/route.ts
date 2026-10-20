import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { withdrawLeave } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/** POST /api/v1/teacher/tutoring/leave/:id/withdraw: a request of the tutor's own, still waiting for the office. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const { id } = await params;
  return answer(ctx.tenant, ctx.actor, await withdrawLeave(ctx.tenant, ctx.actor, id));
}
