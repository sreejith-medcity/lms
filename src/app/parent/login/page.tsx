import { redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant';
import { getParentSession } from '@/lib/parent-session';
import { settingBool } from '@/lib/settings/store';
import { AuthShell } from '@/components/auth-shell';
import { ParentLoginForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parent sign in', robots: { index: false, follow: false } };

export default async function ParentLoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; signedout?: string }> }) {
  const [tenant, session, q] = await Promise.all([getTenantContext(), getParentSession(), searchParams]);
  if (session) redirect('/parent');
  const on = tenant ? await settingBool(tenant.organizationId, 'auth.parentPortal') : false;
  // Why the phone is on this page, when it was signed in before.
  const why = q.signedout === 'all' ? 'Every device has been signed out. Sign in again here with a fresh code.' : q.expired ? 'Your sign-in has expired or was ended on another device. Nothing is lost; sign in again for a fresh code.' : null;

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="For parents"
      subtitle={on ? "See your child's attendance, fees, marks and report cards." : 'The parent view is not switched on at this academy.'}
    >
      {why && (
        <p className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }}>
          {why}
        </p>
      )}
      {on && <ParentLoginForm />}
    </AuthShell>
  );
}
