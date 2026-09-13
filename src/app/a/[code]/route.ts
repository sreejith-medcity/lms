import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { publicOrigin } from '@/lib/http-headers';
import { settingNumber } from '@/lib/settings/store';
import { AFFILIATE_COOKIE, normaliseCode, safeLanding } from '@/lib/affiliates';

export const dynamic = 'force-dynamic';

/**
 * A partner's link. The visitor is remembered in a cookie for the window
 * the academy sets, the click is counted, and they are sent on to wherever
 * the link pointed (on this site only). An unknown or paused code still
 * lands somewhere sensible; it just earns nobody anything.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(request.url);
  const landing = safeLanding(url.searchParams.get('to'));
  const origin = publicOrigin(request);
  const response = NextResponse.redirect(`${origin}${landing}`, 302);

  const tenant = await getTenantContext();
  if (!tenant) return response;

  const affiliate = await db.affiliate.findFirst({
    where: { organizationId: tenant.organizationId, code: normaliseCode(code), status: 'ACTIVE' },
    select: { id: true, code: true },
  });
  if (!affiliate) return response;

  const days = await settingNumber(tenant.organizationId, 'affiliates.cookieDays');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const visitorHash = ip ? createHash('sha256').update(`${ip}|${request.headers.get('user-agent') ?? ''}`).digest('hex').slice(0, 24) : null;
  await db.affiliateClick.create({ data: { affiliateId: affiliate.id, path: landing.slice(0, 200), visitorHash } }).catch(() => null);

  response.cookies.set(AFFILIATE_COOKIE, affiliate.code, {
    maxAge: Math.max(1, Math.min(365, days || 30)) * 86400,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: origin.startsWith('https'),
  });
  return response;
}
