import Link from 'next/link';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card } from '@/components/ui';
import { SecurityPanel } from '@/app/account/security/panel';
import { DevicesPanel, PasswordForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign-in and security' };

/** Which browser is which, from the user agent, without a library. */
function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return browser ? `${browser} on ${os}` : os;
}

export default async function SecurityPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';

  const [account, sessions] = await Promise.all([
    db.user.findFirst({ where: { id: user.id, organizationId: tenant.organizationId }, select: { twoFactorEnabledAt: true, passwordHash: true } }),
    db.authSession.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sessionToken: true, ip: true, userAgent: true, createdAt: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <Link href="/learn/account" className="t-small faint hover:underline">
        Account
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Sign-in and security</h1>
      <p className="t-small faint mt-1">How this account proves it is you, and where it is signed in.</p>

      <div className="mt-6 space-y-4">
        <Card>
          <p className="font-semibold">Password</p>
          <p className="t-small faint mt-0.5">Changing it signs out every other device.</p>
          <div className="mt-4">
            {account?.passwordHash ? (
              <PasswordForm />
            ) : (
              <p className="t-small muted">This account has no password yet: you sign in with a code or with Google. Use &ldquo;Forgot password&rdquo; on the sign-in page to set one.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">Where you are signed in</p>
            <DevicesPanel others={sessions.filter((s) => s.sessionToken !== token).length} />
          </div>
          <ul className="mt-3 divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-sm">{describeDevice(s.userAgent)}</span>
                {s.sessionToken === token && <Badge tone="ok">this device</Badge>}
                <span className="t-small faint ml-auto">
                  since {s.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {s.ip ? ` · ${s.ip}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <SecurityPanel enabled={Boolean(account?.twoFactorEnabledAt)} />
      </div>
    </div>
  );
}
