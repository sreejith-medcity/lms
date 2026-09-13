import { bearerUser } from '@/lib/api/auth';
import { courseDetail } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { productId } = await params;
  const course = await courseDetail(ctx.tenant, ctx.user, productId);
  if (!course) return fail('not_enrolled', 'You are not enrolled in that course.', 404);
  return ok(course);
}
