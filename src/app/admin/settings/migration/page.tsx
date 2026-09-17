import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { resolveIntegration } from '@/lib/integration-store';
import { migrationSummary } from '@/lib/migrate-woo';
import { PageHeader, Card } from '@/components/ui';
import { MigrationConsole } from './console';
import { EdmingleConsole } from './edmingle-console';
import { edmingleSummary } from '@/lib/migrate-edmingle';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Collapsing two systems into one.
 *
 * The argument for this whole build, and the step with the least room for a
 * mistake, so every part of it shows what it would do before it does it.
 */
export default async function MigrationPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.integrations', 'view');
  const canApply = me.permissions['settings.integrations']?.delete ?? false;

  const [woo, done, edmingle, edmingleDone] = await Promise.all([
    resolveIntegration(tenant.organizationId, 'woocommerce'),
    migrationSummary(),
    resolveIntegration(tenant.organizationId, 'edmingle'),
    edmingleSummary(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Migration"
        description="Bringing Edmingle and the WooCommerce store across. Every step can be run as a rehearsal first, and every step is safe to run twice."
      />

      <section className="space-y-4">
        <h2 className="t-heading">Edmingle: the courses</h2>
        {!edmingle?.complete && (
          <Card>
            <p className="font-medium">Edmingle is not connected yet.</p>
            <p className="t-small muted mt-1">
              Signed in to the Edmingle admin panel, copy the &ldquo;apikey&rdquo; and &ldquo;curr_org_id&rdquo; values from the browser&rsquo;s local storage
              onto the Edmingle card in Settings, Integrations. Nothing here ever writes to Edmingle.
            </p>
          </Card>
        )}
        <EdmingleConsole connected={Boolean(edmingle?.complete)} canApply={canApply} done={edmingleDone} />
      </section>

      <h2 className="t-heading pt-4">WooCommerce: the store</h2>

      {!woo?.complete && (
        <Card>
          <p className="font-medium">The store is not connected yet.</p>
          <p className="t-small muted mt-1">
            Generate WooCommerce REST keys with read access, under WooCommerce, Settings, Advanced,
            and put them on the WordPress and WooCommerce card in Settings, Integrations. Read
            access is enough: nothing here ever writes to the old store.
          </p>
        </Card>
      )}

      <MigrationConsole connected={Boolean(woo?.complete)} canApply={canApply} done={done} />
    </div>
  );
}
