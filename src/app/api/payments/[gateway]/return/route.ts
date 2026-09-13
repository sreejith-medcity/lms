import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { publicOrigin } from '@/lib/http-headers';
import { gatewayFor, settle } from '@/lib/payments';
import type { GatewayId } from '@/lib/payments/gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The buyer is back from the gateway. Whatever came with them is handed to
 * the adapter, which checks the signature where there is one and asks the
 * gateway what really happened; only then is the order settled. The
 * webhook does the same job when this never arrives.
 */
async function handle(request: Request, gateway: string) {
  const tenant = await getTenantContext();
  const origin = publicOrigin(request);
  if (!tenant) return NextResponse.redirect(`${origin}/`, 303);

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    form?.forEach((v, k) => (params[k] = String(v)));
  }
  // PayU carries the order in udf1; PhonePe and Stripe in the URL we gave them.
  const orderId = params.orderId || params.udf1 || '';
  if (!orderId) return NextResponse.redirect(`${origin}/`, 303);

  const order = await db.order.findFirst({
    where: { id: orderId, organizationId: tenant.organizationId },
    select: { id: true, orderNo: true, status: true, totalPaise: true, gatewayOrderId: true, userId: true },
  });
  if (!order) return NextResponse.redirect(`${origin}/`, 303);
  const back = `${origin}/checkout/${order.id}`;
  if (order.status === 'PAID') return NextResponse.redirect(back, 303);
  if (params.cancelled === '1') return NextResponse.redirect(`${back}?failed=cancelled`, 303);

  const adapter = await gatewayFor(tenant.organizationId, gateway as GatewayId);
  if (!adapter) return NextResponse.redirect(`${back}?failed=gateway`, 303);

  try {
    const confirmation = await adapter.confirm({ orderNo: order.orderNo, gatewayOrderId: order.gatewayOrderId, amountPaise: order.totalPaise, params });
    const outcome = await settle({ organizationId: tenant.organizationId, gatewayId: adapter.id, orderId: order.id, userId: order.userId, confirmation });
    if (outcome === 'PAID') return NextResponse.redirect(back, 303);
    if (outcome === 'PENDING') return NextResponse.redirect(`${back}?pending=1`, 303);
    return NextResponse.redirect(`${back}?failed=payment`, 303);
  } catch (err) {
    console.error('[payments/return]', err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${back}?failed=check`, 303);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  return handle(request, gateway);
}

export async function POST(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  return handle(request, gateway);
}
