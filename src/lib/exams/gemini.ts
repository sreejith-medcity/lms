import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';

/**
 * One call into Gemini for the test portal's marking.
 *
 * Gemini rather than a transcript-then-text model because speaking is
 * marked from the recording itself: pronunciation and fluency are heard,
 * and the browser's own recordings (webm from Chrome, mp4 from an iPhone)
 * go in as they are. The answer is constrained to a JSON schema and read
 * field by field by the caller. Every call is written to the Google AI
 * card's history, since it is billed per token.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.5-flash';
/* Marking a recording takes twenty to thirty seconds; this bounds the pathological case. */
const TIMEOUT_MS = 75_000;
const RETRY = new Set([408, 429, 500, 502, 503, 504]);

export async function geminiReady(organizationId: string): Promise<boolean> {
  const r = await resolveIntegration(organizationId, 'google_ai');
  return Boolean(r?.values.apiKey);
}

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function askGemini(input: {
  organizationId: string;
  parts: GeminiPart[];
  schema: unknown;
  purpose: string;
}): Promise<{ json: Record<string, unknown>; model: string }> {
  const resolved = await resolveIntegration(input.organizationId, 'google_ai');
  const key = resolved?.values.apiKey;
  if (!key) throw new Error('GEMINI_NOT_CONNECTED');
  const model = (resolved?.values.model ?? '').trim() || DEFAULT_MODEL;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: input.parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: input.schema },
  });

  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      continue;
    }
    if (res.ok) {
      const d = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      await recordIntegrationEvent({
        organizationId: input.organizationId,
        provider: 'google_ai',
        direction: 'OUT',
        action: input.purpose,
        ok: true,
        records: 1,
        detail: `${model}: ${d.usageMetadata?.promptTokenCount ?? 0} in, ${d.usageMetadata?.candidatesTokenCount ?? 0} out`,
      });
      try {
        return { json: JSON.parse(text) as Record<string, unknown>, model };
      } catch {
        throw new Error('GEMINI_NOT_JSON');
      }
    }
    last = `${res.status}: ${(await res.text()).slice(0, 300)}`;
    if (!RETRY.has(res.status)) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  await recordIntegrationEvent({ organizationId: input.organizationId, provider: 'google_ai', direction: 'OUT', action: input.purpose, ok: false, detail: last.slice(0, 400) });
  throw new Error(`GEMINI_FAILED ${last.slice(0, 120)}`);
}
