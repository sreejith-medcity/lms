import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { storageConfigured } from '@/lib/storage';
import { OrganisationForm, BrandingForm } from './forms';

export const dynamic = 'force-dynamic';

export default async function OrganisationSettings() {
  const tenant = await requireTenant();
  await requireStaff('settings.organization', 'view');

  const org = await db.organization.findUniqueOrThrow({
    where: { id: tenant.organizationId },
    select: {
      name: true,
      legalName: true,
      website: true,
      supportEmail: true,
      contactNumber: true,
      addressLine: true,
      city: true,
      state: true,
      pincode: true,
      timezone: true,
      currency: true,
      brandColor: true,
      logoUrl: true,
      faviconUrl: true,
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <OrganisationForm org={org} />
      <BrandingForm
        brandColor={org.brandColor}
        logoUrl={org.logoUrl}
        faviconUrl={org.faviconUrl}
        storageReady={storageConfigured()}
      />
    </div>
  );
}
