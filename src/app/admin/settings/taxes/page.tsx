import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { TaxForm } from './form';

export const dynamic = 'force-dynamic';

export default async function TaxSettings() {
  const tenant = await requireTenant();
  await requireStaff('settings.taxes', 'view');

  const [config, org] = await Promise.all([
    db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId, branchId: null },
    }),
    db.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { state: true },
    }),
  ]);

  return (
    <div className="max-w-2xl">
      <TaxForm
        config={{
          enabled: config?.enabled ?? true,
          gstin: config?.gstin ?? '',
          pan: config?.pan ?? '',
          state: config?.state ?? org.state ?? '',
          cgstPercent: config?.cgstPercent ?? 9,
          sgstPercent: config?.sgstPercent ?? 9,
          igstPercent: config?.igstPercent ?? 18,
          pricesAreExclusive: config?.pricesAreExclusive ?? true,
        }}
      />
    </div>
  );
}
