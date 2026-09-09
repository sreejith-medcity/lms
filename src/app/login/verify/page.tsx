import { redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant';
import { pendingUserId } from '@/lib/sign-in';
import { AuthShell } from '@/components/auth-shell';
import { VerifyForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The second factor gate.
 *
 * Reachable only with the pending cookie, which is not a session. Somebody who
 * navigates here directly is sent back to sign in, rather than shown a form
 * that could never work.
 */
export default async function VerifyPage() {
  const [tenant, userId] = await Promise.all([getTenantContext(), pendingUserId()]);
  if (!userId) redirect('/login');

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="One more step"
      subtitle="This account has two factor turned on."
    >
      <VerifyForm />
    </AuthShell>
  );
}
