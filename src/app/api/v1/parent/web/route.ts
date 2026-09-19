import { bearerParent } from '@/lib/api/parent';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { signHandoff } from '@/lib/api/tokens';

export const dynamic = 'force-dynamic';

/**
 * POST { path } → a URL that opens that parent web page already signed
 * in, good for two minutes and one use. How the app pays a fee, opens a
 * receipt or a notice's file: those go through the web view with the
 * same parent session behind them.
 */
export async function POST(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const path = str(body?.path, 500) || '/parent';
  if (!path.startsWith('/') || path.startsWith('//')) return fail('bad_path', 'A path on this academy, starting with /.', 400);
  const token = signHandoff(`parent:${ctx.parent.contact}`, path);
  return ok({ url: `/api/v1/auth/handoff?token=${encodeURIComponent(token)}`, expiresInSeconds: 120 });
}
