import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/tenant';
import { providerConfig, issueState, type Provider } from '@/lib/sso';
import { redirectResponse } from '@/lib/http-headers';

export const dynamic = 'force-dynamic';

function redirectUri(request: Request, provider: string): string {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/${provider}/callback`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  }

  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Unknown host.' }, { status: 404 });

  const config = await providerConfig(tenant.organizationId, provider as Provider);
  if (!config) {
    // Back to the form with something a person can act on, rather than a JSON
    // error on a blank page.
    return redirectResponse('/login?sso=unconfigured');
  }

  const state = await issueState(provider as Provider);

  const authorize = new URL(config.authorizeUrl);
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', redirectUri(request, provider));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', config.scope);
  authorize.searchParams.set('state', state);
  // Ask for the account chooser rather than silently reusing whichever account
  // the browser last used, which on a shared desk is the wrong one.
  authorize.searchParams.set('prompt', 'select_account');

  return NextResponse.redirect(authorize);
}
