import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { SETTING_GROUPS, SETTINGS } from '@/lib/settings/registry';
import { loadSettings, changedKeys } from '@/lib/settings/store';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { PageHeader } from '@/components/ui';
import { SettingsBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Preferences.
 *
 * Rendered from the registry rather than hand-laid, which is what makes the
 * search, the defaults, the change history and the export all work without
 * being built four times.
 */
export default async function PreferencesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;
  const tz = tenant.timezone;

  const [values, changed, history] = await Promise.all([
    loadSettings(tenant.organizationId),
    changedKeys(tenant.organizationId),
    db.auditLog.findMany({
      where: { organizationId: tenant.organizationId, action: 'settings.changed' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        entityId: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  // Last change per setting, so each row can say who moved it and when.
  const lastChange = new Map<string, string>();
  for (const entry of history) {
    if (!entry.entityId || lastChange.has(entry.entityId)) continue;
    lastChange.set(
      entry.entityId,
      `${entry.actor?.name ?? 'somebody'}, ${formatDayLabel(dayKey(entry.createdAt, tz), tz)}`,
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preferences"
        description="How this academy behaves. Each one says what it changes, what it is set to now, and what happens if you move it."
      />

      <SettingsBoard
        canEdit={canEdit}
        groups={SETTING_GROUPS.map((g) => ({ ...g }))}
        settings={SETTINGS.map((s) => ({
          key: s.key,
          group: s.group,
          label: s.label,
          help: s.help,
          kind: s.kind,
          options: s.options ?? null,
          min: s.min ?? null,
          max: s.max ?? null,
          unit: s.unit ?? null,
          live: s.live,
          multiline: s.multiline ?? false,
          placeholder: s.placeholder ?? null,
          waitingOn: s.waitingOn ?? null,
          default: s.default,
          value: values[s.key],
          isChanged: changed.has(s.key),
          effect: s.effect?.(values[s.key]) ?? null,
          lastChange: lastChange.get(s.key) ?? null,
        }))}
      />
    </div>
  );
}
