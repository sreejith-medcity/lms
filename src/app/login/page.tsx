import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { resolveIntegration } from '@/lib/integration-store';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const [tenant, user, params] = await Promise.all([
    getTenantContext(),
    getSessionUser(),
    searchParams,
  ]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');

  // The buttons appear only where the academy has actually connected the
  // provider, so nobody is offered a door that leads to an error page.
  const sso: string[] = [];
  if (tenant) {
    const [google, microsoft] = await Promise.all([
      resolveIntegration(tenant.organizationId, 'google_sso'),
      resolveIntegration(tenant.organizationId, 'microsoft_sso'),
    ]);
    if (google?.complete) sso.push('google');
    if (microsoft?.complete) sso.push('microsoft');
  }

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="font-medium text-[var(--ink)] hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm sso={sso} problem={params.sso} />
    </AuthShell>
  );
}
