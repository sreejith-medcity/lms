import type { $Enums } from '@prisma/client';
import { resolveIntegration } from '@/lib/integration-store';
import { INTEGRATIONS } from '@/lib/integrations';
import type { Sender } from './types';
import { smtpSender, resendSender, sendgridSender, postmarkSender, sesSender } from './email';
import { msg91Sender, twilioSender, exotelSender } from './sms';
import {
  aisensySender,
  watiSender,
  gupshupSender,
  whatsappCloudSender,
  interaktSender,
} from './whatsapp';

/**
 * Which provider carries which channel.
 *
 * An academy connects whichever ones it has, and this picks the first complete
 * one in priority order rather than making somebody choose a default in a
 * dropdown they will never revisit. If two are connected the higher priority
 * wins, which is the one they were set up with.
 */

type Build = (values: Record<string, string>) => Sender;

const BUILDERS: Record<string, Build> = {
  // Email
  smtp: smtpSender,
  resend: resendSender,
  sendgrid: sendgridSender,
  postmark: postmarkSender,
  ses: sesSender,
  // SMS
  msg91: msg91Sender,
  twilio: twilioSender,
  exotel: exotelSender,
  // WhatsApp
  aisensy: aisensySender,
  wati: watiSender,
  gupshup: gupshupSender,
  whatsapp_cloud: whatsappCloudSender,
  interakt: interaktSender,
};

const CHANNEL_CATEGORY: Partial<Record<$Enums.Channel, string>> = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
};

export interface Resolution {
  sender: Sender | null;
  /** Why there is no sender, in words a person can act on. */
  reason?: string;
}

export async function senderFor(
  organizationId: string,
  channel: $Enums.Channel,
): Promise<Resolution> {
  const category = CHANNEL_CATEGORY[channel];
  if (!category) {
    return {
      sender: null,
      reason: `${channel} is delivered inside the product, so it has no external provider.`,
    };
  }

  const candidates = INTEGRATIONS.filter(
    (def) => def.category === category && BUILDERS[def.id],
  ).sort((a, b) => a.priority - b.priority);

  if (!candidates.length) {
    return { sender: null, reason: `No ${category} provider is implemented yet.` };
  }

  const partial: string[] = [];

  for (const def of candidates) {
    const resolved = await resolveIntegration(organizationId, def.id);
    if (!resolved) continue;
    if (!resolved.complete) {
      if (resolved.fromEnv.length || Object.keys(resolved.values).length) partial.push(def.name);
      continue;
    }
    return { sender: BUILDERS[def.id](resolved.values) };
  }

  return {
    sender: null,
    reason: partial.length
      ? `${partial.join(' and ')} ${partial.length === 1 ? 'is' : 'are'} half filled in, so nothing can send on ${category}. Finish the connection in Settings, Integrations.`
      : `No ${category} provider is connected. Connect one in Settings, Integrations.`,
  };
}

/** What the admin can show without trying to send anything. */
export async function channelReadiness(
  organizationId: string,
): Promise<Record<string, { ready: boolean; provider: string | null; reason: string | null }>> {
  const out: Record<string, { ready: boolean; provider: string | null; reason: string | null }> = {};

  for (const channel of ['EMAIL', 'SMS', 'WHATSAPP'] as $Enums.Channel[]) {
    const resolution = await senderFor(organizationId, channel);
    out[channel] = {
      ready: Boolean(resolution.sender),
      provider: resolution.sender?.provider ?? null,
      reason: resolution.reason ?? null,
    };
  }
  return out;
}

export type { Sender } from './types';
