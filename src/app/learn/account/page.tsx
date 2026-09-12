import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { settingBool } from '@/lib/settings/store';
import { fieldsFor } from '@/lib/custom-fields';
import { Card, ProgressBar } from '@/components/ui';
import { AvatarForm, ConsentForm, DetailsForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account' };

/**
 * The learner's own page about themselves.
 *
 * Name and email are locked unless the academy says otherwise, because a
 * certificate and an exam registration have to match what was enrolled;
 * the rest is theirs to keep current. The academy's own questions (the
 * ones asked after signup rather than on it) live here too, which is the
 * first time they have had anywhere to be answered.
 */
export default async function AccountPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const [account, custom, canName, canEmail, canPhone] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        dateOfBirth: true,
        gender: true,
        registrationNo: true,
        createdAt: true,
        emailOptOut: true,
        smsOptOut: true,
        whatsappOptOut: true,
        learnerProfile: {
          select: {
            occupation: true,
            schoolOrCollege: true,
            area: true,
            residentialAddress: true,
            permanentAddress: true,
            parentName: true,
            parentPhone: true,
            parentEmail: true,
            alternatePhone: true,
            profileCompletion: true,
          },
        },
      },
    }),
    fieldsFor(tenant.organizationId, 'LEARNER', user.id),
    settingBool(tenant.organizationId, 'profile.canEditName'),
    settingBool(tenant.organizationId, 'profile.canEditEmail'),
    settingBool(tenant.organizationId, 'profile.canEditPhone'),
  ]);
  if (!account) return null;

  const completion = account.learnerProfile?.profileCompletion ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Account</h1>
          <p className="t-small faint mt-1">
            {account.registrationNo ? `Registration ${account.registrationNo} · ` : ''}
            with {tenant.name} since {account.createdAt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link href="/learn/account/security" className="t-small font-medium underline">
          Sign-in and security
        </Link>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <AvatarForm name={account.name} avatarUrl={account.avatarUrl} />
          </Card>
          <Card>
            <p className="t-eyebrow faint">Profile</p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">{completion}%</span>
              <span className="t-small faint">complete</span>
            </div>
            <div className="mt-2">
              <ProgressBar value={completion} />
            </div>
            <p className="t-small faint mt-2">A photo, a mobile number and an address get it most of the way.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <p className="font-semibold">Your details</p>
            <p className="t-small faint mt-0.5">
              {!canName && !canEmail
                ? 'Your name and email are set by the academy so they match your enrolment; ask the office to change them.'
                : 'Keep these current; reminders and receipts use them.'}
            </p>
            <div className="mt-4">
              <DetailsForm
                account={{
                  name: account.name,
                  email: account.email ?? '',
                  phone: account.phone ?? '',
                  dateOfBirth: account.dateOfBirth ? account.dateOfBirth.toISOString().slice(0, 10) : '',
                  gender: account.gender ?? '',
                  occupation: account.learnerProfile?.occupation ?? '',
                  schoolOrCollege: account.learnerProfile?.schoolOrCollege ?? '',
                  area: account.learnerProfile?.area ?? '',
                  residentialAddress: account.learnerProfile?.residentialAddress ?? '',
                  permanentAddress: account.learnerProfile?.permanentAddress ?? '',
                  parentName: account.learnerProfile?.parentName ?? '',
                  parentPhone: account.learnerProfile?.parentPhone ?? '',
                  parentEmail: account.learnerProfile?.parentEmail ?? '',
                  alternatePhone: account.learnerProfile?.alternatePhone ?? '',
                }}
                can={{ name: canName, email: canEmail, phone: canPhone }}
                custom={custom.map((f) => ({
                  key: f.key,
                  label: f.label,
                  type: f.type,
                  options: f.options,
                  required: f.required,
                  value: Array.isArray(f.value) ? f.value.join(', ') : f.value == null ? '' : String(f.value),
                }))}
              />
            </div>
          </Card>

          <Card>
            <p className="font-semibold">Messages from {tenant.name}</p>
            <p className="t-small faint mt-0.5">
              Receipts, class reminders and sign-in codes always come. This is about the rest: news about courses, offers, and nudges.
            </p>
            <div className="mt-4">
              <ConsentForm email={!account.emailOptOut} sms={!account.smsOptOut} whatsapp={!account.whatsappOptOut} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
