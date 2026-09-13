import { apiTenant } from '@/lib/api/auth';
import { tenantPublic } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** The academy's branding and sign-in options, before anyone signs in: what the app draws its first screen from. */
export async function GET() {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  return ok(await tenantPublic(tenant), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
