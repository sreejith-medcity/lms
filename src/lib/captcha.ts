import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingNumber } from '@/lib/settings/store';
import { readVerdict, type CaptchaProvider, type CaptchaVerdict } from '@/lib/captcha-verdict';

/**
 * A bot check on the two forms a stranger can post: sign-up and enquiry.
 * Google reCAPTCHA v3 (a score, no puzzle) or Cloudflare Turnstile (a
 * token, no puzzle for almost everyone). Neither asks a real person to do
 * anything, and neither runs until its keys are on the integration card.
 */

export type { CaptchaProvider } from '@/lib/captcha-verdict';

export interface CaptchaSite {
  provider: CaptchaProvider;
  siteKey: string;
}

/** What the page needs to render the check, or null when none is set up. */
export async function captchaSite(organizationId: string): Promise<CaptchaSite | null> {
  const turnstile = await resolveIntegration(organizationId, 'turnstile');
  if (turnstile?.complete) return { provider: 'turnstile', siteKey: turnstile.values.siteKey };
  const recaptcha = await resolveIntegration(organizationId, 'recaptcha');
  if (recaptcha?.complete) return { provider: 'recaptcha', siteKey: recaptcha.values.siteKey };
  return null;
}

/**
 * Check a token the form carried. No keys means no check, which is honest:
 * the form worked before the check existed and the card says it is off.
 */
export async function verifyCaptcha(organizationId: string, token: string | null, action: 'signup' | 'enquiry', ip: string | null): Promise<CaptchaVerdict> {
  const site = await captchaSite(organizationId);
  if (!site) return { ok: true };
  if (!token) return { ok: false, reason: 'no token' };

  const resolved = await resolveIntegration(organizationId, site.provider);
  const secret = resolved?.values.secretKey;
  if (!secret) return { ok: true };

  const endpoint = site.provider === 'turnstile' ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : 'https://www.google.com/recaptcha/api/siteverify';
  const params = new URLSearchParams({ secret, response: token });
  if (ip) params.set('remoteip', ip);

  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const minScore = await settingNumber(organizationId, 'security.captchaMinScore');
    const verdict = readVerdict(site.provider, body, action, Number.isFinite(minScore) ? minScore : 0.5);
    if (!verdict.ok) {
      await recordIntegrationEvent({ organizationId, provider: site.provider, direction: 'CHECK', action: `Refused a ${action}`, ok: false, detail: verdict.reason ?? null });
    }
    return verdict;
  } catch (err) {
    // The check itself failing is not the visitor's fault: let them through and say so.
    await recordIntegrationEvent({ organizationId, provider: site.provider, direction: 'CHECK', action: `Could not check a ${action}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
    return { ok: true, reason: 'unreachable' };
  }
}

export const CAPTCHA_REFUSED = 'That did not look like a person. If it is, please try again in a moment.';
