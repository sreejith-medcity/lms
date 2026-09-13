import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { signHandoff } from '@/lib/api/tokens';

export const dynamic = 'force-dynamic';

/**
 * POST { path } → a URL that opens that web page already signed in, good
 * for two minutes. How the app reaches screens it does not draw itself:
 * a test, the checkout, a certificate.
 */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const path = str(body?.path, 500) || '/learn';
  if (!path.startsWith('/') || path.startsWith('//')) return fail('bad_path', 'A path on this academy, starting with /.', 400);
  const token = signHandoff(ctx.user.id, path);
  return ok({ url: `/api/v1/auth/handoff?token=${encodeURIComponent(token)}`, expiresInSeconds: 120 });
}
