import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { INTEGRATIONS, integrationsByCategory } from '@/lib/integrations';
import { summariseAll } from '@/lib/integration-store';
import { PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { IntegrationBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * What this is plugged into.
 *
 * Credentials are entered here rather than only in the environment, because a
 * second academy on this build should be able to use its own payment gateway
 * without a redeploy. Anything set in the environment still wins: that is
 * deliberate, is the same for every request, and cannot be changed by whoever
 * gets into the admin.
 */
export default async function IntegrationsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.integrations', 'view');
  const canEdit = me.permissions['settings.integrations']?.edit ?? false;

  const summaries = await summariseAll(tenant.organizationId);

  const wired = INTEGRATIONS.filter((i) => i.status === 'wired');
  const connected = INTEGRATIONS.filter((i) => summaries.get(i.id)?.complete);
  const running = wired.filter((i) => summaries.get(i.id)?.complete);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Everything this can be plugged into. Credentials are sealed before they are stored and never shown again."
      />

      <StatGrid>
        <Stat
          label="Running"
          value={running.length}
          sub={`of ${wired.length} the code reads today`}
        />
        <Stat
          label="Credentials stored"
          value={connected.length}
          sub={`across ${INTEGRATIONS.length} providers`}
        />
        <Stat
          label="Waiting on code"
          value={INTEGRATIONS.filter((i) => i.status === 'planned').length}
          sub="mostly Phase 7"
        />
        <Stat label="Categories" value={integrationsByCategory().length} />
      </StatGrid>

      <IntegrationBoard
        canEdit={canEdit}
        categories={integrationsByCategory().map((c) => ({
          key: c.key,
          label: c.label,
          blurb: c.blurb,
          items: c.items.map((def) => {
            const summary = summaries.get(def.id);
            return {
              id: def.id,
              name: def.name,
              purpose: def.purpose,
              status: def.status,
              landsIn: def.landsIn ?? null,
              docsUrl: def.docsUrl ?? null,
              fallback: def.fallback ?? null,
              envOnly: def.envOnly ?? false,
              fields: def.fields.map((f) => ({
                key: f.key,
                label: f.label,
                kind: f.kind,
                hint: f.hint ?? null,
                placeholder: f.placeholder ?? null,
                env: f.env ?? null,
                filled: summary?.filled.includes(f.key) ?? false,
                fromEnv: summary?.fromEnv.includes(f.key) ?? false,
                tail: summary?.tails[f.key] ?? null,
                /** Plain values are safe to show again; secrets never are. */
                value: null,
              })),
              complete: summary?.complete ?? false,
              fromEnvCount: summary?.fromEnv.length ?? 0,
            };
          }),
        }))}
      />
    </div>
  );
}
