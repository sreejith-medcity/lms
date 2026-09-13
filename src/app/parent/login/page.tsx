import { redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant';
import { getParentSession } from '@/lib/parent-session';
import { settingBool } from '@/lib/settings/store';
import { AuthShell } from '@/components/auth-shell';
import { ParentLoginForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parent sign in', robots: { index: false, follow: false } };

export default async function ParentLoginPage() {
  const [tenant, session] = await Promise.all([getTenantContext(), getParentSession()]);
  if (session) redirect('/parent');
  const on = tenant ? await settingBool(tenant.organizationId, 'auth.parentPortal') : false;

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="For parents"
      subtitle={on ? "See your child's attendance, fees, marks and report cards." : 'The parent view is not switched on at this academy.'}
    >
      {on && <ParentLoginForm />}
    </AuthShell>
  );
}
