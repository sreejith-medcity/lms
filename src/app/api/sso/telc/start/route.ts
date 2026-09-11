import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { telcHandoffUrl } from '@/lib/telc';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { publicOrigin, redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';

/**
 * The learner presses Open; this signs them in over there.
 * Nobody signed in here is sent to sign in first and comes back to the same place.
 */
export async function GET(request: Request) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return redirectResponse(`/login?next=${encodeURIComponent('/api/sso/telc/start')}`);

  const url = await telcHandoffUrl({
    organizationId: tenant.organizationId,
    userId: user.id,
    returnTo: `${publicOrigin(request)}/learn`,
  });
  if (!url) return redirectResponse('/learn?practice=unavailable');

  await recordIntegrationEvent({
    organizationId: tenant.organizationId,
    provider: 'telc',
    direction: 'OUT',
    action: 'Learner signed in',
    ok: true,
    records: 1,
  });

  return NextResponse.redirect(url, 302);
}
