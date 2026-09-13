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
    // A verified sending domain of the academy's own replaces the provider's
    // From, and signs SMTP mail with the academy's DKIM key. API providers
    // check the domain on their own side; the From still changes here.
    if (category === 'email') {
      const { sendingIdentity } = await import('@/lib/email-domain');
      const own = await sendingIdentity(organizationId).catch(() => null);
      if (own) {
        const values: Record<string, string> = { ...resolved.values, fromEmail: own.fromEmail, fromName: own.fromName ?? resolved.values.fromName ?? '' };
        if (own.dkim) {
          values.dkimDomain = own.dkim.domainName;
          values.dkimSelector = own.dkim.keySelector;
          values.dkimPrivateKey = own.dkim.privateKey;
        }
        return { sender: BUILDERS[def.id](values) };
      }
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
  const { pushConfigured } = await import('./push');
  out.PUSH = {
    ready: pushConfigured(),
    provider: pushConfigured() ? 'web-push' : null,
    reason: pushConfigured() ? null : 'Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the environment (npx web-push generate-vapid-keys makes a pair).',
  };
  out.IN_APP = { ready: true, provider: 'in-app', reason: null };
  return out;
}

export type { Sender } from './types';
