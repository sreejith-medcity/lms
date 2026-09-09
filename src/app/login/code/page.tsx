import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { AuthShell } from '@/components/auth-shell';
import { CodeForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CodeLoginPage() {
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="Sign in with a code"
      subtitle="No password needed. We send a six digit code to your phone."
    >
      <CodeForm />
    </AuthShell>
  );
}
