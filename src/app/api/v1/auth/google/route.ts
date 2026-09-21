import { db } from '@/lib/db';
import { apiTenant, issueTokens } from '@/lib/api/auth';
import { clientIp, fail, ok, readJson, str } from '@/lib/api/http';
import { resolveIntegration } from '@/lib/integration-store';
import { authAttemptKeys, checkAll } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Sign in with Google from the phone.
 *
 * The app gets an id token from Google's own sign-in on the phone and
 * hands it here. It is checked with Google (tokeninfo), which says who
 * it is for and whether it was minted for this academy's client id, so a
 * token from any other app is refused. The same rules as the web door:
 * an account is matched by the Google subject already linked, then by
 * verified email; never created.
 */
interface TokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  exp?: string;
  error_description?: string;
}

export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  const idToken = str(body?.idToken, 4096);
  if (!idToken) return fail('missing', 'Send the Google id token.', 400);

  const limit = checkAll(authAttemptKeys('google', tenant.tenantId, 'app', clientIp(request)), 20, 15 * 60);
  if (!limit.ok) return fail('too_many', 'Too many tries. Wait a few minutes.', 429, { retryAfter: limit.retryAfterSeconds });

  const config = await resolveIntegration(tenant.organizationId, 'google_sso');
  if (!config?.complete || !config.values.clientId) return fail('unconfigured', 'Google sign-in is not set up for this academy.', 400);

  let info: TokenInfo;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    info = (await res.json()) as TokenInfo;
    if (!res.ok) return fail('refused', 'Google did not accept that sign-in. Try again.', 401);
  } catch {
    return fail('google_down', 'Google could not be reached. Try again in a moment.', 502);
  }
  // The token must have been minted for this academy's own web client, or
  // for the app's Android or iOS client listed beside it on the card.
  const allowed = [config.values.clientId, ...(config.values.appClientIds ?? '').split(',')].map((s) => s.trim()).filter(Boolean);
  if (!info.sub || !info.aud || !allowed.includes(info.aud)) return fail('refused', 'That sign-in was not made for this academy.', 401);
  if (info.exp && Number(info.exp) * 1000 < Date.now()) return fail('expired', 'That sign-in has expired. Try again.', 401);
  const email = (info.email ?? '').trim().toLowerCase();
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!email || !verified) return fail('unverified', 'Google has not verified that email address.', 401);

  const linked = await db.authAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: info.sub } },
    select: { userId: true, user: { select: { organizationId: true, deletedAt: true, kind: true, status: true } } },
  });
  let user: { id: string; kind: 'LEARNER' | 'STAFF'; status: string } | null = null;
  if (linked && linked.user.organizationId === tenant.organizationId && !linked.user.deletedAt) {
    user = { id: linked.userId, kind: linked.user.kind, status: linked.user.status };
  } else {
    const byEmail = await db.user.findFirst({ where: { organizationId: tenant.organizationId, email, deletedAt: null }, select: { id: true, kind: true, status: true } });
    if (!byEmail) return fail('nomatch', 'No account here uses that Google address. Enrol first, or sign in another way.', 404);
    user = byEmail;
    await db.authAccount.upsert({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: info.sub } },
      create: { userId: byEmail.id, provider: 'google', providerAccountId: info.sub },
      update: { userId: byEmail.id },
    });
  }
  if (user.status === 'SUSPENDED' || user.status === 'ARCHIVED') return fail('blocked', 'This account is not active. Contact your academy.', 403);
  await db.user.updateMany({ where: { id: user.id, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  const tokens = await issueTokens(tenant.organizationId, user.id, user.kind, str(body?.device, 120) || null);
  return ok(tokens);
}
