import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from './form';
import { settingText } from '@/lib/settings/store';
import { optionsOf, signupFields } from '@/lib/custom-fields';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (user) redirect(user.kind === 'STAFF' ? '/admin' : '/learn');

  // The form asks for what this academy asks for, rather than what the product
  // happens to have shipped with.
  const primaryField = tenant ? await settingText(tenant.organizationId, 'auth.primaryField') : 'EMAIL';
  const extraFields = tenant
    ? (await signupFields(tenant.organizationId, 'BEFORE')).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as string,
        options: optionsOf(f.options),
        required: f.signupRequired,
      }))
    : [];

  return (
    <AuthShell
      orgName={tenant?.name ?? 'Academy'}
      title="Create your account"
      subtitle={`Join ${tenant?.name ?? 'the academy'} and start learning.`}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--ink)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm
        referralCode={(ref ?? '').trim().toUpperCase().slice(0, 16)}
        primaryField={primaryField}
        extraFields={extraFields}
      />
    </AuthShell>
  );
}
