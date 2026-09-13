import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { readHandoff } from '@/lib/api/tokens';
import { completeSignIn } from '@/lib/sign-in';

export const dynamic = 'force-dynamic';

const used = new Map<string, number>();

/** GET ?token= → sets the web session cookie and lands on the path. One use, two minutes. */
export async function GET(request: Request) {
  const tenant = await getTenantContext();
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const claims = readHandoff(token);
  if (!tenant || !claims) return NextResponse.redirect(new URL('/login', url.origin));
  const now = Date.now();
  for (const [k, t] of used) if (t < now - 5 * 60_000) used.delete(k);
  if (used.has(claims.nonce)) return NextResponse.redirect(new URL('/login', url.origin));
  used.set(claims.nonce, now);
  const user = await db.user.findFirst({ where: { id: claims.sub, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true } });
  if (!user) return NextResponse.redirect(new URL('/login', url.origin));
  const outcome = await completeSignIn(user.id);
  if (outcome.status !== 'signed-in') return NextResponse.redirect(new URL('/login', url.origin));
  return NextResponse.redirect(new URL(claims.path, url.origin));
}
