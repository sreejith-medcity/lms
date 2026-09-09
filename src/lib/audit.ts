/**
 * Audit trail. Every privileged mutation records who did what to which record,
 * so an academy can answer "who changed this price" without reading logs.
 *
 * Writes are best effort: an audit failure must never roll back the business
 * action that succeeded, but it is logged loudly so a broken trail is visible.
 */
import { headers } from 'next/headers';
import { db } from '@/lib/db';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        ip,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record', entry.action, entry.entity, err);
  }
}
