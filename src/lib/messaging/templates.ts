import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { orderedVariables } from './render';

/**
 * What a message actually says.
 *
 * An academy's own template wins. Where there is none, a built-in default is
 * used rather than nothing, because an OTP that does not arrive because nobody
 * wrote a template is a bug dressed up as configuration. The defaults are
 * deliberately plain: they are meant to be replaced, and they say enough to be
 * useful until they are.
 *
 * WhatsApp is the exception. Meta has to approve the wording, so a default here
 * cannot be sent, and the resolver returns the provider template name that the
 * academy registered rather than inventing text that would be rejected.
 */

export interface ResolvedTemplate {
  subject: string | null;
  body: string;
  /** The name Meta approved, for the providers that send templates by name. */
  templateName: string | null;
  orderedVariables?: (context: Record<string, string>) => string[];
}

interface Default {
  subject?: string;
  body: string;
}

/**
 * Written in the second person and without pleasantries, because these arrive on
 * a phone and the useful part should be in the first line.
 */
const DEFAULTS: Record<string, Default> = {
  'account.otp': {
    subject: 'Your {{organization}} code',
    body: '{{code}} is your {{organization}} verification code. It is good for {{minutes}} minutes. Do not share it with anyone.',
  },
  'account.two_factor': {
    subject: 'Your {{organization}} sign-in code',
    body: '{{code}} is your sign-in code for {{organization}}. It expires in {{minutes}} minutes.',
  },
  'account.welcome': {
    subject: 'Your {{organization}} account is ready',
    body: 'Hello {{name}}, your {{organization}} account is ready. Sign in at {{loginUrl}} with {{identifier}}.',
  },
  'account.password_reset': {
    subject: 'Reset your {{organization}} password',
    body: 'Hello {{name}}, use {{resetUrl}} to set a new password. The link is good for {{minutes}} minutes. If this was not you, nothing has changed.',
  },
  'session.reminder': {
    subject: '{{title}} starts at {{time}}',
    body: 'Hello {{name}}, {{title}} starts at {{time}} on {{date}}. Join here: {{joinUrl}}',
  },
  'session.absent': {
    subject: 'You missed {{title}}',
    body: 'Hello {{name}}, you were not marked present for {{title}} on {{date}}. The recording goes up when it is ready, and your trainer can go over it with you.',
  },
  'session.cancelled': {
    subject: '{{title}} on {{date}} is off',
    body: 'Hello {{name}}, {{title}} on {{date}} will not run. {{reason}}',
  },
  'session.recording': {
    subject: 'The recording of {{title}} is up',
    body: 'Hello {{name}}, the recording of {{title}} from {{date}} is now in your course. {{url}}',
  },
  'payment.received': {
    subject: 'We received {{amount}}',
    body: 'Hello {{name}}, we received {{amount}} for {{item}}. Your receipt is at {{receiptUrl}}.',
  },
  'payment.failed': {
    subject: 'That payment did not go through',
    body: 'Hello {{name}}, the payment of {{amount}} for {{item}} did not go through, and nothing has been charged. You can try again at {{retryUrl}}.',
  },
  'instalment.due': {
    subject: '{{amount}} for {{item}} is {{stage}}',
    body: 'Hello {{name}}, an instalment of {{amount}} for {{item}} is due on {{date}}. Pay online at {{payUrl}} or at the academy. If you have already paid, please ignore this.',
  },
  'cart.abandoned': {
    subject: 'You left {{item}} in your cart',
    body: 'Hello {{name}}, {{item}} is still in your cart. Finish enrolling at {{url}}.',
  },
  'course.welcome': {
    subject: 'You are enrolled in {{item}}',
    body: 'Hello {{name}}, you are enrolled in {{item}}. Start here: {{url}}',
  },
  'course.completed': {
    subject: 'You finished {{item}}',
    body: 'Hello {{name}}, you have finished {{item}}. Well done.',
  },
  'certificate.issued': {
    subject: 'Your certificate for {{item}}',
    body: 'Hello {{name}}, your certificate for {{item}} is ready. Download it at {{url}}. Anyone can check it with the code {{code}}.',
  },
  'assessment.marked': {
    subject: '{{item}} has been marked',
    body: 'Hello {{name}}, {{item}} has been marked. You scored {{score}}. See it at {{url}}.',
  },
  'assignment.set': {
    subject: 'New homework: {{item}}',
    body: 'Hello {{name}}, {{item}} has been set for {{course}}. {{due}} See it at {{url}}.',
  },
  'assignment.graded': {
    subject: '{{item}} has been marked',
    body: 'Hello {{name}}, your work on {{item}} has been marked: {{score}}. Read the feedback at {{url}}.',
  },
  'announcement.published': {
    subject: '{{title}}',
    body: '{{body}}',
  },
};

export async function templateFor(
  organizationId: string,
  eventKey: string,
  channel: $Enums.Channel,
): Promise<ResolvedTemplate | null> {
  const own = await db.messageTemplate.findFirst({
    where: { organizationId, eventKey, channel },
    orderBy: { updatedAt: 'desc' },
    select: { subject: true, body: true, providerTemplateId: true },
  });

  if (own) {
    return {
      subject: own.subject,
      body: own.body,
      templateName: own.providerTemplateId,
      orderedVariables: (context) => orderedVariables(own.body, context),
    };
  }

  if (channel === 'WHATSAPP') {
    // Nothing to fall back on. Meta approves the wording, so sending our own
    // text here would be rejected by the provider and charged for by nobody.
    return null;
  }

  const fallback = DEFAULTS[eventKey];
  if (!fallback) return null;

  return {
    subject: fallback.subject ?? null,
    body: fallback.body,
    templateName: null,
    orderedVariables: (context) => orderedVariables(fallback.body, context),
  };
}

/**
 * The wording for a queued row: a saved template named on the row, the text
 * the row carries itself, or the event's own template. In that order, so a
 * campaign or an automation says what it was written to say.
 */
export async function templateForRow(
  organizationId: string,
  row: { eventKey: string; channel: $Enums.Channel; templateKey: string | null; context: unknown },
): Promise<ResolvedTemplate | null> {
  const key = row.templateKey ?? '';
  if (key.startsWith('tpl:')) {
    const own = await db.messageTemplate.findFirst({
      where: { id: key.slice(4), organizationId, channel: row.channel },
      select: { subject: true, body: true, providerTemplateId: true },
    });
    if (!own) return null;
    return {
      subject: own.subject,
      body: own.body,
      templateName: own.providerTemplateId,
      orderedVariables: (context) => orderedVariables(own.body, context),
    };
  }
  if (key === 'inline') {
    const context = (row.context ?? {}) as Record<string, string>;
    const body = String(context._body ?? '');
    if (!body.trim()) return null;
    return {
      subject: String(context._subject ?? '') || null,
      body,
      templateName: null,
      orderedVariables: (ctx) => orderedVariables(body, ctx),
    };
  }
  return templateFor(organizationId, row.eventKey, row.channel);
}

/** For the settings screen, so an academy can see what it would send today. */
export function defaultTemplate(eventKey: string): Default | null {
  return DEFAULTS[eventKey] ?? null;
}

export const DEFAULT_EVENT_KEYS = Object.keys(DEFAULTS);
