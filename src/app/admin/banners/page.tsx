import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { storageConfigured } from '@/lib/storage';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { BannerCard, NewBanner } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const PLACEMENT_LABELS: Record<string, string> = {
  LEARNER_HOME: 'Learner dashboard',
  SITE_HOME: 'Public home page',
  CATALOGUE: 'Course catalogue',
};

export default async function BannersPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('banner.manage_banners', 'view');
  const canEdit = me.permissions['banner.manage_banners']?.edit ?? false;

  const banners = await db.banner.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      name: true,
      imageAssetId: true,
      linkUrl: true,
      placement: true,
      isActive: true,
      sortOrder: true,
    },
  });

  const groups = Object.entries(PLACEMENT_LABELS).map(([placement, label]) => ({
    placement,
    label,
    items: banners.filter((b) => b.placement === placement),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banners"
        description="The strip at the top of a page. One at a time is a message; four is wallpaper nobody reads."
      />

      {banners.length === 0 ? (
        <EmptyState title="No banners yet" hint="Upload artwork below and choose where it appears." />
      ) : (
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.placement} className="space-y-3">
              <h2 className="t-heading">{g.label}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map((b, i) => (
                  <BannerCard
                    key={b.id}
                    canEdit={canEdit}
                    banner={{
                      id: b.id,
                      name: b.name,
                      imageAssetId: b.imageAssetId,
                      linkUrl: b.linkUrl,
                      isActive: b.isActive,
                    }}
                    canMoveUp={i > 0}
                    canMoveDown={i < g.items.length - 1}
                  />
                ))}
              </div>
            </section>
          ))
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Add a banner</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Wide artwork works best: it is shown at full width and cropped on a phone. A banner with
            no link is a notice; one with a link is an advert, and both are fine.
          </p>
          <div className="mt-4">
            <NewBanner storageReady={storageConfigured()} />
          </div>
        </Card>
      )}
    </div>
  );
}
