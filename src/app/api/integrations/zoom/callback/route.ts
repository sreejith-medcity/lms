import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { resolveIntegration } from '@/lib/integration-store';
import { saveZoomConnection, zoomRedirectUri } from '@/lib/zoom-connect';
import { publicOrigin, redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Zoom sending the browser back with a code.
 *
 * Three things are checked before the code is spent: the person is still a
 * staff member who may change integrations, the state matches the signed
 * cookie set when they left, and the state names this academy. Only then is
 * the code exchanged, and what comes back is sealed like every other secret.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenant = await requireTenant();
  const user = await getSessionUser();

  if (!user || user.kind !== 'STAFF' || !user.permissions['settings.integrations']?.edit) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const error = url.searchParams.get('error');
  if (error) return redirectResponse(`/admin/settings/integrations?zoom=${encodeURIComponent(error)}`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code) return redirectResponse('/admin/settings/integrations?zoom=no-code');

  const [organizationId, nonce, signature] = state.split('.');
  const expected = createHmac('sha256', process.env.AUTH_SECRET ?? 'insecure-development-secret')
    .update(`${organizationId}.${nonce}`)
    .digest('base64url')
    .slice(0, 24);

  const jar = await cookies();
  const cookieState = jar.get('mlms_zoom_state')?.value ?? '';

  if (
    organizationId !== tenant.organizationId ||
    signature !== expected ||
    cookieState !== `${nonce}.${signature}`
  ) {
    return redirectResponse('/admin/settings/integrations?zoom=state-mismatch');
  }
  jar.delete('mlms_zoom_state');

  const resolved = await resolveIntegration(tenant.organizationId, 'zoom');
  const clientId = resolved?.values.clientId;
  const clientSecret = resolved?.values.clientSecret;
  if (!clientId || !clientSecret) {
    return redirectResponse('/admin/settings/integrations?zoom=needs-client-id');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: zoomRedirectUri(publicOrigin(request)),
  });

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error('[zoom connect]', response.status, (await response.text()).slice(0, 200));
    return redirectResponse('/admin/settings/integrations?zoom=refused');
  }

  const token = (await response.json()) as { access_token: string; refresh_token: string };

  // Who we are connected as, asked of Zoom rather than assumed, because that
  // is the line the card shows and the account every meeting will belong to.
  const me = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: 'no-store',
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ email?: string; account_id?: string }>) : null))
    .catch(() => null);

  await saveZoomConnection({
    organizationId: tenant.organizationId,
    refreshToken: token.refresh_token,
    connectedAs: me?.email ?? 'a Zoom account',
  });

  await recordAudit({
    organizationId: tenant.organizationId,
    actorId: user.id,
    action: 'integration.connected',
    entity: 'Integration',
    entityId: 'zoom',
    after: { connectedAs: me?.email ?? null, via: 'oauth' },
  });

  return redirectResponse('/admin/settings/integrations?zoom=connected');
}
