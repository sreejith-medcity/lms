import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { resolveIntegration } from '@/lib/integration-store';
import { signHandoff } from '@/lib/partner-sso';

/**
 * The telc mock test as a partner: where it is, and how a learner gets in.
 */

export async function telcConfig(organizationId: string): Promise<{ baseUrl: string; secret: string } | null> {
  const resolved = await resolveIntegration(organizationId, 'telc');
  const baseUrl = resolved?.values.baseUrl?.trim().replace(/\/+$/, '');
  const secret = resolved?.values.sharedSecret;
  if (!baseUrl || !secret || !/^https:\/\//.test(baseUrl)) return null;
  return { baseUrl, secret };
}

/**
 * The address that signs this learner into the partner. Carries what they
 * are enrolled in, so the partner can open the right level without asking.
 */
export async function telcHandoffUrl(input: {
  organizationId: string;
  userId: string;
  returnTo?: string;
}): Promise<string | null> {
  const config = await telcConfig(input.organizationId);
  if (!config) return null;

  const user = await db.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      enrollments: {
        where: { status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } },
        select: { product: { select: { title: true } } },
      },
    },
  });
  if (!user) return null;

  const token = signHandoff(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      org: input.organizationId,
      returnTo: input.returnTo,
      grants: user.enrollments.map((e) => e.product.title).slice(0, 20),
      jti: randomBytes(12).toString('base64url'),
    },
    config.secret,
    new Date(),
  );

  return `${config.baseUrl}/api/lms/login?token=${encodeURIComponent(token)}`;
}
