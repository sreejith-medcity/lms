import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { settingText } from '@/lib/settings/store';

/**
 * One call into Claude, and nothing clever around it.
 *
 * The key comes from the Anthropic card (or ANTHROPIC_API_KEY), the model
 * from a setting, and every call is written to the integration history
 * with its token counts, because a model is billed per token and an
 * academy should be able to see where the money went.
 */

export async function anthropicReady(organizationId: string): Promise<boolean> {
  const resolved = await resolveIntegration(organizationId, 'anthropic');
  return Boolean(resolved?.values.apiKey);
}

export interface ClaudeReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function askClaude(input: {
  organizationId: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Named in the integration history: "Marked writing", "Wrote a task". */
  purpose: string;
}): Promise<ClaudeReply> {
  const resolved = await resolveIntegration(input.organizationId, 'anthropic');
  const apiKey = resolved?.values.apiKey;
  if (!apiKey) throw new Error('ANTHROPIC_NOT_CONNECTED');

  const model = (await settingText(input.organizationId, 'ai.model')).trim() || 'claude-sonnet-4-5';

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? 1500,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    await recordIntegrationEvent({
      organizationId: input.organizationId,
      provider: 'anthropic',
      direction: 'OUT',
      action: input.purpose,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw new Error('ANTHROPIC_UNREACHABLE');
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    await recordIntegrationEvent({
      organizationId: input.organizationId,
      provider: 'anthropic',
      direction: 'OUT',
      action: input.purpose,
      ok: false,
      detail: `Anthropic answered ${response.status}: ${detail}`,
    });
    throw new Error(`ANTHROPIC_${response.status}`);
  }

  const body = (await response.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const inputTokens = body.usage?.input_tokens ?? 0;
  const outputTokens = body.usage?.output_tokens ?? 0;

  await recordIntegrationEvent({
    organizationId: input.organizationId,
    provider: 'anthropic',
    direction: 'OUT',
    action: input.purpose,
    ok: true,
    records: 1,
    detail: `${model}: ${inputTokens} in, ${outputTokens} out`,
  });

  return { text, inputTokens, outputTokens };
}
