import { db } from '@/lib/db';
import { open } from '@/lib/secrets';
import { integrationById, type IntegrationDef } from '@/lib/integrations';

/**
 * Resolving an integration's credentials.
 *
 * The environment wins. A key set in hPanel is deliberate, is the same for
 * every request, and cannot be changed by anybody who gets into the admin, so
 * it outranks a value typed into a form. The database fills the gaps, which is
 * what makes a second academy on this build able to use its own gateway without
 * a redeploy.
 *
 * Secrets come back decrypted here and nowhere else. Nothing in this file is
 * safe to send to a browser.
 */

export type Credentials = Record<string, string>;

export interface ResolvedIntegration {
  def: IntegrationDef;
  values: Credentials;
  /** Keys whose value came from the environment rather than the database. */
  fromEnv: string[];
  /** Every required field has a value. */
  complete: boolean;
}

function readEnv(def: IntegrationDef): { values: Credentials; keys: string[] } {
  const values: Credentials = {};
  const keys: string[] = [];

  for (const field of def.fields) {
    if (!field.env) continue;
    const raw = process.env[field.env]?.trim();
    if (raw) {
      values[field.key] = raw;
      keys.push(field.key);
    }
  }
  return { values, keys };
}

export async function resolveIntegration(
  organizationId: string,
  provider: string,
): Promise<ResolvedIntegration | null> {
  const def = integrationById(provider);
  if (!def) return null;

  const env = readEnv(def);

  const row = await db.integration.findFirst({
    where: { organizationId, provider },
    select: { credentials: true },
  });

  const stored = (row?.credentials ?? {}) as Record<string, unknown>;
  const values: Credentials = {};

  for (const field of def.fields) {
    if (env.values[field.key]) {
      values[field.key] = env.values[field.key];
      continue;
    }
    const raw = stored[field.key];
    if (typeof raw !== 'string' || raw.length === 0) continue;

    // Secrets are sealed; plain fields are stored as they were typed.
    values[field.key] = field.kind === 'secret' ? (open(raw) ?? '') : raw;
  }

  const complete = def.fields
    .filter((f) => !f.hint?.startsWith('Optional') && !f.hint?.startsWith('Only'))
    .every((f) => Boolean(values[f.key]));

  return { def, values, fromEnv: env.keys, complete };
}

/**
 * What the screen may see: which fields are filled, and where from. Never a
 * secret's value, because a page that can render one is a page that can leak
 * one.
 */
export interface IntegrationSummary {
  provider: string;
  connected: boolean;
  complete: boolean;
  filled: string[];
  fromEnv: string[];
  /** Last four characters of each secret, so somebody can tell test from live. */
  tails: Record<string, string>;
  /** Plain fields as stored, so the form shows what it has rather than a blank. */
  plain: Record<string, string>;
  connectedAt: string | null;
}

export async function summarise(
  organizationId: string,
  provider: string,
): Promise<IntegrationSummary> {
  const def = integrationById(provider);
  const empty: IntegrationSummary = {
    provider,
    connected: false,
    complete: false,
    filled: [],
    fromEnv: [],
    tails: {},
    plain: {},
    connectedAt: null,
  };
  if (!def) return empty;

  const resolved = await resolveIntegration(organizationId, provider);
  if (!resolved) return empty;

  const row = await db.integration.findFirst({
    where: { organizationId, provider },
    select: { isConnected: true, connectedAt: true },
  });

  const tails: Record<string, string> = {};
  const plain: Record<string, string> = {};
  for (const field of def.fields) {
    const value = resolved.values[field.key];
    if (!value) continue;
    if (field.kind === 'secret') tails[field.key] = value.slice(-4);
    else plain[field.key] = value;
  }

  return {
    provider,
    connected: Boolean(row?.isConnected) || resolved.fromEnv.length > 0,
    complete: resolved.complete,
    filled: Object.keys(resolved.values).filter((k) => resolved.values[k]),
    fromEnv: resolved.fromEnv,
    tails,
    plain,
    connectedAt: row?.connectedAt ? row.connectedAt.toISOString() : null,
  };
}

/**
 * What this institute has said the other side's fields are called.
 *
 * Kept in `config` rather than beside the credentials, so saving a mapping can
 * never touch a sealed key and a wrong mapping is one field to fix rather than
 * a reconnect.
 */
export async function readMappings(
  organizationId: string,
  provider: string,
): Promise<Record<string, string>> {
  const row = await db.integration.findFirst({
    where: { organizationId, provider },
    select: { config: true },
  });
  const config = (row?.config ?? {}) as Record<string, unknown>;
  const mappings = config.mappings;
  if (!mappings || typeof mappings !== 'object') return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(mappings as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

export async function readAllMappings(
  organizationId: string,
): Promise<Map<string, Record<string, string>>> {
  const rows = await db.integration.findMany({
    where: { organizationId },
    select: { provider: true, config: true },
  });

  const out = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const config = (row.config ?? {}) as Record<string, unknown>;
    const mappings = config.mappings;
    if (!mappings || typeof mappings !== 'object') continue;

    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(mappings as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
    }
    if (Object.keys(clean).length) out.set(row.provider, clean);
  }
  return out;
}

export async function summariseAll(organizationId: string): Promise<Map<string, IntegrationSummary>> {
  const rows = await db.integration.findMany({
    where: { organizationId },
    select: { provider: true, isConnected: true, connectedAt: true, credentials: true },
  });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const { INTEGRATIONS } = await import('@/lib/integrations');
  const out = new Map<string, IntegrationSummary>();

  for (const def of INTEGRATIONS) {
    const env = readEnv(def);
    const stored = (byProvider.get(def.id)?.credentials ?? {}) as Record<string, unknown>;

    const filled: string[] = [];
    const tails: Record<string, string> = {};
    const plain: Record<string, string> = {};

    for (const field of def.fields) {
      const fromEnv = env.values[field.key];
      const raw = fromEnv ?? (typeof stored[field.key] === 'string' ? (stored[field.key] as string) : '');
      if (!raw) continue;

      filled.push(field.key);
      if (field.kind === 'secret') {
        const opened = fromEnv ?? open(raw) ?? '';
        if (opened) tails[field.key] = opened.slice(-4);
      } else {
        plain[field.key] = raw;
      }
    }

    const complete = def.fields
      .filter((f) => !f.hint?.startsWith('Optional') && !f.hint?.startsWith('Only'))
      .every((f) => filled.includes(f.key));

    const row = byProvider.get(def.id);

    out.set(def.id, {
      provider: def.id,
      connected: Boolean(row?.isConnected) || env.keys.length > 0,
      complete,
      filled,
      fromEnv: env.keys,
      tails,
      plain,
      connectedAt: row?.connectedAt ? row.connectedAt.toISOString() : null,
    });
  }

  return out;
}
