import { bearerUser } from '@/lib/api/auth';
import { lessonDetail } from '@/lib/api/lessons';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { materialId } = await params;
  const lesson = await lessonDetail(ctx.tenant, ctx.user, materialId);
  if (!lesson.ok) return fail(lesson.code, lesson.message, lesson.code === 'locked' ? 423 : 404, lesson.until ? { until: lesson.until } : undefined);
  return ok(lesson);
}
