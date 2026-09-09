import { db } from '@/lib/db';

/**
 * The history of what an integration has actually done.
 *
 * A connection screen that shows a green dot and nothing else cannot be
 * trusted. Green means "a key is stored", which is not the same as "leads are
 * arriving", and the gap between those two is where an institute quietly loses
 * a fortnight of enquiries. So every attempt is written down: what it was, which
 * way it went, whether it worked, and how many records moved.
 *
 * Written with raw SQL rather than the generated client on purpose. The table is
 * declared in schema.prisma like everything else, but the client is regenerated
 * at deploy, and this file has to compile before that happens. The queries are
 * parameterised, so this is a build-order concession and not a security one.
 */

export type Direction = 'IN' | 'OUT' | 'CHECK';

export interface IntegrationEvent {
  id: string;
  provider: string;
  direction: Direction;
  action: string;
  ok: boolean;
  records: number;
  detail: string | null;
  createdAt: Date;
}

/** Never let a provider's error message carry a credential into the log. */
function scrub(detail: string | undefined | null): string | null {
  if (!detail) return null;
  const trimmed = detail.trim().slice(0, 500);
  return trimmed.replace(/\b(rzp_(live|test)_[A-Za-z0-9]+|sk_[A-Za-z0-9]+|EA[A-Za-z0-9]{20,})\b/g, '••••');
}

export async function recordIntegrationEvent(input: {
  organizationId: string;
  provider: string;
  direction: Direction;
  action: string;
  ok?: boolean;
  records?: number;
  detail?: string | null;
}): Promise<void> {
  try {
    await db.$executeRaw`
      INSERT INTO "integration_events"
        ("id", "organizationId", "provider", "direction", "action", "ok", "records", "detail", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        ${input.organizationId},
        ${input.provider},
        ${input.direction},
        ${input.action},
        ${input.ok ?? true},
        ${input.records ?? 0},
        ${scrub(input.detail)},
        now()
      )
    `;
  } catch (err) {
    // History is a record of the work, never a reason the work fails.
    console.error('[integration-events]', err instanceof Error ? err.message : String(err));
  }
}

export async function recentIntegrationEvents(
  organizationId: string,
  provider: string,
  take = 10,
): Promise<IntegrationEvent[]> {
  try {
    const rows = await db.$queryRaw<IntegrationEvent[]>`
      SELECT "id", "provider", "direction", "action", "ok", "records", "detail", "createdAt"
      FROM "integration_events"
      WHERE "organizationId" = ${organizationId} AND "provider" = ${provider}
      ORDER BY "createdAt" DESC
      LIMIT ${take}
    `;
    return rows;
  } catch {
    return [];
  }
}

export interface ProviderActivity {
  provider: string;
  lastAt: Date | null;
  lastOk: boolean | null;
  lastAction: string | null;
  failures24h: number;
}

/**
 * One row per provider that has ever done anything, for the board. Cheap enough
 * to run on every render, which matters because a status you have to click for
 * is a status nobody looks at.
 */
export async function providerActivity(organizationId: string): Promise<Map<string, ProviderActivity>> {
  const out = new Map<string, ProviderActivity>();
  try {
    const rows = await db.$queryRaw<
      { provider: string; lastAt: Date; lastOk: boolean; lastAction: string; failures: bigint }[]
    >`
      SELECT DISTINCT ON ("provider")
        "provider",
        "createdAt" AS "lastAt",
        "ok" AS "lastOk",
        "action" AS "lastAction",
        (
          SELECT COUNT(*) FROM "integration_events" f
          WHERE f."organizationId" = e."organizationId"
            AND f."provider" = e."provider"
            AND f."ok" = false
            AND f."createdAt" > now() - interval '24 hours'
        ) AS "failures"
      FROM "integration_events" e
      WHERE "organizationId" = ${organizationId}
      ORDER BY "provider", "createdAt" DESC
    `;

    for (const row of rows) {
      out.set(row.provider, {
        provider: row.provider,
        lastAt: row.lastAt,
        lastOk: row.lastOk,
        lastAction: row.lastAction,
        failures24h: Number(row.failures ?? 0),
      });
    }
  } catch {
    // The table is created at deploy. Before then, no history is the truth.
  }
  return out;
}
