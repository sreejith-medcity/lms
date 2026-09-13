import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { AffiliateForm } from '../editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NewAffiliatePage() {
  await requireTenant();
  await requireStaff('marketing.campaigns', 'edit');
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="New partner" description="A name, a code for their link, and their share. The link is on the next screen." />
      <AffiliateForm draft={null} />
    </div>
  );
}
