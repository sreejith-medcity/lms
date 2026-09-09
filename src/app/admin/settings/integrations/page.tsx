import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { INTEGRATIONS, integrationsByGroup } from '@/lib/integrations';
import { summariseAll, readAllMappings } from '@/lib/integration-store';
import { providerActivity } from '@/lib/integration-events';
import { PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { IntegrationBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * What this is plugged into.
 *
 * Credentials are entered here rather than only in the environment, because a
 * second academy on this build should be able to use its own payment gateway,
 * its own ad accounts and its own CRM without a redeploy. Anything set in the
 * environment still wins: that is deliberate, is the same for every request,
 * and cannot be changed by whoever gets into the admin.
 *
 * Three things are on this page that a connect button usually leaves out. What
 * the provider needs from you before you start, so nobody discovers halfway
 * through that the plan does not include the API. What the fields are called on
 * the other side, entered per institute rather than hard-coded. And what has
 * actually happened since, because a green dot only means a key is stored.
 */
export default async function IntegrationsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.integrations', 'view');
  const canEdit = me.permissions['settings.integrations']?.edit ?? false;
  const canDelete = me.permissions['settings.integrations']?.delete ?? false;

  const [summaries, mappings, activity] = await Promise.all([
    summariseAll(tenant.organizationId),
    readAllMappings(tenant.organizationId),
    providerActivity(tenant.organizationId),
  ]);

  const wired = INTEGRATIONS.filter((i) => i.status === 'wired');
  const connected = INTEGRATIONS.filter((i) => summaries.get(i.id)?.complete);
  const running = wired.filter((i) => summaries.get(i.id)?.complete);
  const failing = [...activity.values()].filter((a) => a.failures24h > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Everything this can be plugged into. Each institute connects its own accounts, and credentials are sealed before they are stored."
      />

      <StatGrid>
        <Stat label="Running" value={running.length} sub={`of ${wired.length} the code reads today`} />
        <Stat
          label="Credentials stored"
          value={connected.length}
          sub={`across ${INTEGRATIONS.length} providers`}
        />
        <Stat
          label="Failing"
          value={failing}
          sub={failing ? 'errors in the last 24 hours' : 'nothing has errored'}
        />
        <Stat
          label="Waiting on code"
          value={INTEGRATIONS.filter((i) => i.status === 'planned').length}
          sub="Phase 7 onward"
        />
      </StatGrid>

      <IntegrationBoard
        canEdit={canEdit}
        canDelete={canDelete}
        groups={integrationsByGroup().map((g) => ({
          group: g.group,
          categories: g.categories.map((c) => ({
            key: c.key,
            label: c.label,
            blurb: c.blurb,
            items: c.items.map((def) => {
              const summary = summaries.get(def.id);
              const saved = mappings.get(def.id) ?? {};
              const last = activity.get(def.id);

              return {
                id: def.id,
                name: def.name,
                purpose: def.purpose,
                status: def.status,
                priority: def.priority,
                landsIn: def.landsIn ?? null,
                docsUrl: def.docsUrl ?? null,
                fallback: def.fallback ?? null,
                requires: def.requires ?? null,
                alternativeTo: def.alternativeTo
                  ? (INTEGRATIONS.find((i) => i.id === def.alternativeTo)?.name ?? null)
                  : null,
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
                mappings: (def.mappings ?? []).map((m) => ({
                  key: m.key,
                  label: m.label,
                  help: m.help ?? null,
                  suggested: m.suggested ?? null,
                  value: saved[m.key] ?? '',
                })),
                complete: summary?.complete ?? false,
                fromEnvCount: summary?.fromEnv.length ?? 0,
                lastAt: last?.lastAt ? last.lastAt.toISOString() : null,
                lastOk: last?.lastOk ?? null,
                lastAction: last?.lastAction ?? null,
                failures24h: last?.failures24h ?? 0,
              };
            }),
          })),
        }))}
      />
    </div>
  );
}
