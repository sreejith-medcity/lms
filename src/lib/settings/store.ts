import { cache } from 'react';
import { db } from '@/lib/db';
import { SETTINGS, settingByKey, type SettingDef } from './registry';

/**
 * Reading settings, with the defaults doing the work.
 *
 * Only values that differ from their default are stored. That is not a
 * space saving: it means a default can be improved later and every academy that
 * never touched the setting gets the improvement, rather than being frozen at
 * whatever the default was on the day they signed up.
 *
 * One query per request, cached, because a page that reads six settings should
 * not make six round trips.
 */

export type SettingValue = boolean | number | string;
export type SettingMap = Record<string, SettingValue>;

function coerce(def: SettingDef, raw: unknown): SettingValue {
  if (def.kind === 'boolean') return Boolean(raw);
  if (def.kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return def.default;
    return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
  }
  if (def.kind === 'select') {
    const value = String(raw);
    return def.options?.some((o) => o.value === value) ? value : def.default;
  }
  return String(raw ?? '');
}

export const loadSettings = cache(async (organizationId: string): Promise<SettingMap> => {
  const rows = await db.orgSetting.findMany({
    where: { organizationId, key: { startsWith: 'pref.' } },
    select: { key: true, value: true },
  });

  const stored = new Map(rows.map((r) => [r.key.slice('pref.'.length), r.value]));

  const map: SettingMap = {};
  for (const def of SETTINGS) {
    map[def.key] = stored.has(def.key) ? coerce(def, stored.get(def.key)) : def.default;
  }
  return map;
});

/** One setting, for the places that only need one. */
export async function setting(organizationId: string, key: string): Promise<SettingValue> {
  const all = await loadSettings(organizationId);
  return all[key] ?? settingByKey(key)?.default ?? '';
}

export async function settingBool(organizationId: string, key: string): Promise<boolean> {
  return Boolean(await setting(organizationId, key));
}

export async function settingNumber(organizationId: string, key: string): Promise<number> {
  return Number(await setting(organizationId, key));
}

export async function settingText(organizationId: string, key: string): Promise<string> {
  return String(await setting(organizationId, key));
}

/** Which ones this academy has actually changed, for the "not default" marks. */
export async function changedKeys(organizationId: string): Promise<Set<string>> {
  const rows = await db.orgSetting.findMany({
    where: { organizationId, key: { startsWith: 'pref.' } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key.slice('pref.'.length)));
}
