import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { zoomAuthoriseUrl } from '@/lib/zoom-connect';
import { publicOrigin, redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Sending an admin to Zoom to sign in.
 *
 * The state is signed and also put in a short cookie, so the answer coming
 * back has to match both: without it, anybody could walk a staff member into
 * connecting an academy to a Zoom account of the attacker's choosing.
 */
export async function GET(request: Request) {
  const tenant = await requireTenant();
  const user = await getSessionUser();

  if (!user || user.kind !== 'STAFF' || !user.permissions['settings.integrations']?.edit) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const resolved = await resolveIntegration(tenant.organizationId, 'zoom');
  const clientId = resolved?.values.clientId;
  if (!clientId) {
    return redirectResponse('/admin/settings/integrations?zoom=needs-client-id');
  }

  const nonce = randomBytes(16).toString('base64url');
  const state = `${tenant.organizationId}.${nonce}`;
  const signature = createHmac('sha256', process.env.AUTH_SECRET ?? 'insecure-development-secret')
    .update(state)
    .digest('base64url')
    .slice(0, 24);

  (await cookies()).set('mlms_zoom_state', `${nonce}.${signature}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  const origin = publicOrigin(request);
  return NextResponse.redirect(
    zoomAuthoriseUrl({ clientId, origin, state: `${state}.${signature}` }),
  );
}
