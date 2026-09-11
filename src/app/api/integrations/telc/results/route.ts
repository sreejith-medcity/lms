import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { telcConfig } from '@/lib/telc';
import { parseResultPayload, verifyResultSignature } from '@/lib/partner-sso';
import { recordIntegrationEvent } from '@/lib/integration-events';

export const dynamic = 'force-dynamic';

/**
 * A result, posted back by the partner when a learner finishes.
 *
 * Signed over the timestamp and the exact body with the shared secret;
 * refused when the signature is wrong or the timestamp is more than five
 * minutes off. Keyed on the partner's own attempt id, so a retry updates
 * the row it already wrote rather than adding a second.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });

  const config = await telcConfig(tenant.organizationId);
  if (!config) return NextResponse.json({ error: 'The telc partner is not connected here.' }, { status: 503 });

  const check = verifyResultSignature({
    rawBody: raw,
    secret: config.secret,
    signature: request.headers.get('x-lms-signature'),
    timestamp: request.headers.get('x-lms-timestamp'),
    now: new Date(),
  });
  if (!check.ok) {
    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider: 'telc',
      direction: 'IN',
      action: 'Result refused',
      ok: false,
      detail: `Signature ${check.reason.toLowerCase()}.`,
    });
    return NextResponse.json({ error: `Signature ${check.reason.toLowerCase()}.` }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 });
  }
  const parsed = parseResultPayload(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.result;

  const user = await db.user.findFirst({
    where: { id: r.userId, organizationId: tenant.organizationId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: 'No such learner here.' }, { status: 404 });

  const detail = { modules: r.modules ?? [], raw: body } as unknown as Prisma.InputJsonValue;

  const saved = await db.partnerResult.upsert({
    where: { provider_externalId: { provider: 'telc', externalId: r.externalId } },
    create: {
      organizationId: tenant.organizationId,
      userId: user.id,
      provider: 'telc',
      externalId: r.externalId,
      title: r.title,
      level: r.level,
      scorePercent: r.scorePercent,
      passed: r.passed,
      detail,
      certificateUrl: r.certificateUrl,
      takenAt: new Date(r.takenAt),
    },
    update: {
      title: r.title,
      level: r.level,
      scorePercent: r.scorePercent,
      passed: r.passed,
      detail,
      certificateUrl: r.certificateUrl,
      takenAt: new Date(r.takenAt),
    },
    select: { id: true },
  });

  await recordIntegrationEvent({
    organizationId: tenant.organizationId,
    provider: 'telc',
    direction: 'IN',
    action: 'Result received',
    ok: true,
    records: 1,
  });

  return NextResponse.json({ ok: true, id: saved.id });
}
