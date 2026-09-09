import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { recentIntegrationEvents } from '@/lib/integration-events';
import { integrationById } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/**
 * The history for one connector, fetched when somebody asks for it.
 *
 * Loaded on demand rather than with the page, because a hundred providers each
 * carrying their last ten events would make the board slow for a panel almost
 * nobody opens.
 */
export async function GET(request: Request) {
  try {
    const tenant = await requireTenant();
    await requireStaff('settings.integrations', 'view');

    const provider = new URL(request.url).searchParams.get('provider') ?? '';
    if (!integrationById(provider)) {
      return NextResponse.json({ error: 'No such integration.' }, { status: 404 });
    }

    const rows = await recentIntegrationEvents(tenant.organizationId, provider, 15);

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        action: row.action,
        ok: row.ok,
        records: row.records,
        detail: row.detail,
        createdAt: row.createdAt,
      })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }
}
