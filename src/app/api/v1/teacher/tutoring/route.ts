import { ok } from '@/lib/api/http';
import { notStaff, tutorContext } from '@/lib/api/tutor-api';
import { tutorTutoringView } from '@/lib/tutoring/tutor';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/teacher/tutoring
 *
 * A tutor's online tutoring, the view the web desk draws at
 * /admin/desk/tutoring: the hours they can teach, their groups with the
 * learners and the next class, the progress notes due, their leave, and
 * the hours taught this month. `applies` says whether the screen is worth
 * a place in the app at all.
 */
export async function GET(request: Request) {
  const ctx = await tutorContext(request);
  if (!ctx) return notStaff();
  return ok(await tutorTutoringView(ctx.tenant, ctx.actor.id));
}
