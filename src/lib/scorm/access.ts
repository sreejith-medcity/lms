import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { entitledToLesson } from '@/lib/lesson-entitlement';

/**
 * Who may open a package: the learner entitled to its lesson, or staff.
 * xAPI packages cannot carry a cookie into their fetches reliably, so a
 * launch mints a short token that the LRS routes accept as Basic auth.
 */

export async function packageFor(packageId: string) {
  const tenant = await getTenantContext();
  if (!tenant) return null;
  const pkg = await db.scormPackage.findFirst({ where: { id: packageId, organizationId: tenant.organizationId }, select: { id: true, organizationId: true, materialId: true, standard: true, launchPath: true, storagePrefix: true, masteryScore: true, identifier: true, title: true } });
  return pkg ? { tenant, pkg } : null;
}

/** The signed-in person allowed to open this package, or null. */
export async function viewerFor(packageId: string): Promise<{ userId: string; name: string; organizationId: string; staff: boolean } | null> {
  const found = await packageFor(packageId);
  if (!found) return null;
  const user = await getSessionUser();
  if (!user || user.organizationId !== found.pkg.organizationId) return null;
  if (user.kind === 'STAFF') return { userId: user.id, name: user.name, organizationId: user.organizationId, staff: true };
  try {
    await entitledToLesson(found.pkg.materialId);
    return { userId: user.id, name: user.name, organizationId: user.organizationId, staff: false };
  } catch {
    return null;
  }
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'insecure-development-secret';
}

/** A launch token: package, learner, expiry, signed. Sent to the package as its LRS auth. */
export function mintLaunchToken(packageId: string, userId: string, ttlHours = 12): string {
  const expires = Date.now() + ttlHours * 3_600_000;
  const payload = `${packageId}.${userId}.${expires}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

export function readLaunchToken(authHeader: string | null, packageId: string): { userId: string } | null {
  if (!authHeader?.startsWith('Basic ')) return null;
  let raw: string;
  try {
    raw = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  // Some players send "user:pass"; the token is the whole thing or the password half.
  const candidate = raw.includes(':') && raw.split(':')[1] ? raw.split(':')[1] : raw;
  let decoded: string;
  try {
    decoded = Buffer.from(candidate, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const [pkg, userId, expires, sig] = decoded.split('.');
  if (!pkg || !userId || !expires || !sig || pkg !== packageId) return null;
  if (Number(expires) < Date.now()) return null;
  const expected = createHmac('sha256', secret()).update(`${pkg}.${userId}.${expires}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId };
}
