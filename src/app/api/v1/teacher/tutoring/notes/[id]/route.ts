import { readJson, str } from '@/lib/api/http';
import { answer, notStaff, tutorContext } from '@/lib/api/tutor-api';
import { sendProgressNote } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/teacher/tutoring/notes/:id { rating: 1..5, attendance?, participation?, homework?, comment }
 *
 * A progress note on a learner, asked after their 5th, 10th and 15th class
 * and at the end. The learner, their parents and the office read it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  const { id } = await params;
  const body = await readJson(request);
  return answer(
    ctx.tenant,
    ctx.actor,
    await sendProgressNote(ctx.tenant, ctx.actor.id, { feedbackId: id, rating: body?.rating, attendance: body?.attendance, participation: body?.participation, homework: body?.homework, comment: str(body?.comment, 2000) }),
  );
}
