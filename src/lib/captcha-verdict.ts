export type CaptchaProvider = 'recaptcha' | 'turnstile';

/** The reading of a siteverify answer, kept pure so the shapes can be tested. */
export interface CaptchaVerdict {
  ok: boolean;
  score?: number;
  reason?: string;
}

/** Read the provider's siteverify answer. Pure, so the shapes can be tested. */
export function readVerdict(provider: CaptchaProvider, body: Record<string, unknown>, expectedAction: string, minScore: number): CaptchaVerdict {
  if (body.success !== true) {
    const codes = Array.isArray(body['error-codes']) ? (body['error-codes'] as unknown[]).join(', ') : 'refused';
    return { ok: false, reason: codes };
  }
  if (provider === 'recaptcha') {
    const score = typeof body.score === 'number' ? body.score : 0;
    if (typeof body.action === 'string' && body.action !== expectedAction) return { ok: false, score, reason: `action ${body.action}` };
    return score >= minScore ? { ok: true, score } : { ok: false, score, reason: `score ${score}` };
  }
  if (typeof body.action === 'string' && body.action && body.action !== expectedAction) return { ok: false, reason: `action ${body.action}` };
  return { ok: true };
}
