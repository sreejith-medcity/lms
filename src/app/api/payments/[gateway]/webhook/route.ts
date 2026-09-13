import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { gatewayFor, gatewayRef, settle } from '@/lib/payments';
import type { GatewayId } from '@/lib/payments/gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The gateway calling in. Verified against the raw bytes, recorded whether
 * or not it can be used, then settled the same way the return route does.
 * Reached on the academy's own hostname, which is how the tenant is known.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host' }, { status: 404 });
  const adapter = await gatewayFor(tenant.organizationId, gateway as GatewayId);
  if (!adapter) return NextResponse.json({ error: 'Gateway not connected' }, { status: 404 });

  const raw = await request.text();
  const result = await adapter.webhook(raw, request.headers);
  const eventId = `${adapter.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  await db.gatewayEvent
    .create({
      data: {
        organizationId: tenant.organizationId,
        gateway: gatewayRef(adapter.id),
        eventId,
        event: result.ok ? (result.event ? 'payment' : 'ignored') : 'rejected',
        payload: (raw.length < 60_000 ? { raw } : { truncated: true }) as Prisma.InputJsonValue,
        signatureOk: result.ok,
        error: result.ok ? null : result.reason,
      },
    })
    .catch(() => null);

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  if (!result.event) return NextResponse.json({ ok: true, ignored: true });

  const order = await db.order.findFirst({
    where: {
      organizationId: tenant.organizationId,
      OR: [
        ...(result.event.orderNo ? [{ orderNo: result.event.orderNo }] : []),
        ...(result.event.gatewayOrderId ? [{ gatewayOrderId: result.event.gatewayOrderId }] : []),
      ],
    },
    select: { id: true, userId: true },
  });
  if (!order) return NextResponse.json({ ok: true, ignored: 'no such order' });

  try {
    const outcome = await settle({ organizationId: tenant.organizationId, gatewayId: adapter.id, orderId: order.id, userId: order.userId, confirmation: result.event.confirmation });
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    console.error('[payments/webhook]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not settle' }, { status: 500 });
  }
}
