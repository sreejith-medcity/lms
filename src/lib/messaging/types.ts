/**
 * One shape for every provider.
 *
 * The interesting part is `permanent`. A message that failed because the number
 * is not on WhatsApp will fail identically forever, and retrying it costs money
 * and hides the real failures behind noise. A message that failed because the
 * provider returned a 503 should be tried again in a minute. Providers report
 * these two very differently, so each adapter is responsible for telling them
 * apart, and the drain only has to trust the flag.
 */

export interface OutboundMessage {
  to: string;
  /** Email only. */
  subject?: string;
  /** Plain text, and the WhatsApp or SMS body. */
  body: string;
  html?: string;
  /** WhatsApp template name, where the provider sends templates rather than text. */
  templateName?: string;
  /** Ordered template variables, which is how most Indian providers take them. */
  variables?: string[];
}

export interface SendResult {
  ok: boolean;
  /** The provider's own id, so a delivery report can be matched later. */
  providerRef?: string;
  costPaise: number;
  error?: string;
  /** True when retrying will never help. */
  permanent?: boolean;
}

export interface Sender {
  /** The integration id this came from, written onto the log row. */
  provider: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Every adapter returns this rather than throwing, so one bad send is one row. */
export function failed(error: string, permanent = false): SendResult {
  return { ok: false, costPaise: 0, error: error.slice(0, 300), permanent };
}

export function sent(providerRef: string | undefined, costPaise: number): SendResult {
  return { ok: true, providerRef, costPaise };
}

/**
 * A provider answered, but not with success. 4xx means we sent something wrong
 * and will send the same wrong thing next time; 5xx and 429 are worth retrying.
 */
export function fromStatus(status: number, body: string): SendResult {
  const permanent = status >= 400 && status < 500 && status !== 429 && status !== 408;
  return failed(`${status}: ${body.slice(0, 200)}`, permanent);
}
