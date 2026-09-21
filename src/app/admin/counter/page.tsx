import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { CounterDesk } from './desk';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The front desk. A learner shows their card (My card in the portal or
 * the app); the desk scans it with a barcode reader, the camera, or types
 * the registration number, and sees who they are, what class they have
 * today, and what is owed. One press checks them in.
 */
export default async function CounterPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('learner.learner_management', 'view');
  const canCheckIn = me.permissions['scheduling.sessions']?.edit ?? false;
  const canSeeFees = Boolean(me.permissions['sales.fee_tracking']?.view || me.permissions['sales.payments']?.view);
  return (
    <div className="space-y-6">
      <PageHeader title="Counter" description="Scan a member card, or type a registration number. A barcode reader that types and presses Enter works as it is." />
      <CounterDesk canCheckIn={canCheckIn} canSeeFees={canSeeFees} timezone={tenant.timezone} />
    </div>
  );
}
