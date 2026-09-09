import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { RedirectBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The map from the old site to this one.
 *
 * The one part of the migration that cannot be repaired afterwards, so it gets
 * its own screen rather than living in a config file somebody edits at cutover.
 * Hits are counted, because the only honest way to know the map is finished is
 * to watch which old paths people are still asking for.
 */
export default async function RedirectsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.website', 'view');
  const canEdit = me.permissions['settings.website']?.edit ?? false;
  const canDelete = me.permissions['settings.website']?.delete ?? false;

  const rules = await db.redirect.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ hitCount: 'desc' }, { fromPath: 'asc' }],
    select: { id: true, fromPath: true, toPath: true, statusCode: true, hitCount: true },
  });

  const used = rules.filter((rule) => rule.hitCount > 0);
  const wildcards = rules.filter((rule) => rule.fromPath.endsWith('/*'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redirects"
        description="Where the old store's URLs go now. Rankings live on paths, and a path that 404s loses them in weeks."
      />

      <StatGrid>
        <Stat label="Rules" value={rules.length} sub={`${wildcards.length} cover a whole tree`} />
        <Stat
          label="Used"
          value={used.length}
          sub={used.length ? 'have caught at least one visitor' : 'none have been hit yet'}
        />
        <Stat
          label="Visitors saved"
          value={rules.reduce((sum, rule) => sum + rule.hitCount, 0)}
          sub="would otherwise have hit a 404"
        />
      </StatGrid>

      <RedirectBoard
        canEdit={canEdit}
        canDelete={canDelete}
        rules={rules}
      />
    </div>
  );
}
