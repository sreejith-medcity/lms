import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { removeHours } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/** DELETE /api/v1/teacher/tutoring/hours/:id: one window of the tutor's own hours. Groups already placed stay. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const { id } = await params;
  return answer(ctx.tenant, ctx.actor, await removeHours(ctx.tenant, { ...ctx.actor, isOffice: false }, id));
}
