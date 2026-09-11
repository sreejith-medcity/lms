import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { providerConfig, consumeState, exchangeCode, type Provider } from '@/lib/sso';
import { completeSignIn } from '@/lib/sign-in';
import { publicOrigin, redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';

/**
 * Coming back from Google or Microsoft.
 *
 * Every refusal here sends the person back to the sign-in form with a reason
 * they can act on, rather than a JSON blob. And every refusal says the same
 * thing for "no account" as it does for "wrong account", so this cannot be used
 * to find out who studies at an academy.
 */
function back(request: Request, reason: string) {
  return redirectResponse(`/login?sso=${reason}`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  }

  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });

  const url = new URL(request.url);

  // The person pressed cancel on the provider's screen.
  if (url.searchParams.get('error')) return back(request, 'cancelled');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!(await consumeState(provider as Provider, state))) {
    return back(request, 'expired');
  }
  if (!code) return back(request, 'failed');

  const config = await providerConfig(tenant.organizationId, provider as Provider);
  if (!config) return back(request, 'unconfigured');

  const identity = await exchangeCode({
    config,
    code,
    redirectUri: `${publicOrigin(request)}/api/auth/${provider}/callback`,
  });

  if (!identity) return back(request, 'failed');
  if (!identity.emailVerified) return back(request, 'unverified');

  // An account this provider has already been linked to wins, because an email
  // address can change hands and a provider subject id does not.
  const linked = await db.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    select: { userId: true, user: { select: { organizationId: true, deletedAt: true } } },
  });

  let userId: string | null = null;

  if (linked && linked.user.organizationId === tenant.organizationId && !linked.user.deletedAt) {
    userId = linked.userId;
  } else {
    const byEmail = await db.user.findFirst({
      where: {
        organizationId: tenant.organizationId,
        email: identity.email,
        deletedAt: null,
      },
      select: { id: true },
    });

    // Nothing is created here on purpose. An academy's roll is not something a
    // stranger with a Google account may add themselves to, so an address with
    // no learner behind it is turned away and told to enrol.
    if (!byEmail) return back(request, 'nomatch');

    userId = byEmail.id;

    await db.authAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: identity.providerAccountId,
        },
      },
      create: {
        userId: byEmail.id,
        provider,
        providerAccountId: identity.providerAccountId,
      },
      update: { userId: byEmail.id },
    });
  }

  // Google and Microsoft have both just confirmed the address works.
  await db.user.updateMany({
    where: { id: userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });

  const outcome = await completeSignIn(userId);

  if (outcome.status === 'blocked') return back(request, 'inactive');
  if (outcome.status === 'second-factor') {
    return redirectResponse('/login/verify');
  }

  return redirectResponse(outcome.redirectTo);
}
