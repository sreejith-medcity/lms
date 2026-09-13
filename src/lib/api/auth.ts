import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { getTenantContext, type TenantContext } from '@/lib/tenant';
import { hashRefreshToken, mintRefreshToken, readAccessToken, REFRESH_TTL_DAYS, signAccessToken } from './tokens';

/**
 * Who is calling the API. The bearer token names the person and the
 * academy; the hostname must agree with the academy, so a token minted on
 * one academy's app cannot be replayed on another's.
 */

export interface ApiUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  kind: 'LEARNER' | 'STAFF';
  organizationId: string;
  locale: string;
  avatarUrl: string | null;
  timezone: string;
}

export async function apiTenant(): Promise<TenantContext | null> {
  return getTenantContext();
}

export async function bearerUser(request: Request): Promise<{ tenant: TenantContext; user: ApiUser } | null> {
  const tenant = await getTenantContext();
  if (!tenant) return null;
  const header = request.headers.get('authorization') ?? (await headers()).get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const claims = readAccessToken(header.slice(7).trim());
  if (!claims || claims.org !== tenant.organizationId) return null;
  const user = await db.user.findFirst({
    where: { id: claims.sub, organizationId: tenant.organizationId, deletedAt: null, status: { notIn: ['SUSPENDED', 'ARCHIVED'] } },
    select: { id: true, name: true, email: true, phone: true, kind: true, organizationId: true, locale: true, avatarUrl: true, timezone: true },
  });
  if (!user) return null;
  return { tenant, user };
}

export interface IssuedTokens {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
}

/** A fresh pair for a device, the refresh half recorded. */
export async function issueTokens(organizationId: string, userId: string, kind: 'LEARNER' | 'STAFF', device: string | null): Promise<IssuedTokens> {
  const refresh = mintRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 864e5);
  await db.apiToken.create({ data: { organizationId, userId, tokenHash: refresh.hash, device, expiresAt } });
  await db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  return { accessToken: signAccessToken({ sub: userId, org: organizationId, kind }), accessExpiresIn: 3600, refreshToken: refresh.token, refreshExpiresAt: expiresAt.toISOString() };
}

/** Rotate: the old refresh token is revoked as the new one is issued, so a stolen one works once at most. */
export async function rotateTokens(organizationId: string, refreshToken: string): Promise<IssuedTokens | null> {
  const row = await db.apiToken.findFirst({
    where: { tokenHash: hashRefreshToken(refreshToken), organizationId },
    select: { id: true, userId: true, device: true, expiresAt: true, revokedAt: true, user: { select: { kind: true, deletedAt: true, status: true } } },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  if (row.user.deletedAt || row.user.status === 'SUSPENDED' || row.user.status === 'ARCHIVED') return null;
  await db.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
  return issueTokens(organizationId, row.userId, row.user.kind, row.device);
}

export async function revokeRefreshToken(organizationId: string, refreshToken: string): Promise<void> {
  await db.apiToken.updateMany({ where: { tokenHash: hashRefreshToken(refreshToken), organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
}
