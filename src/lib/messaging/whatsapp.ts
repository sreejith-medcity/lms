import type { Credentials } from '@/lib/integration-store';
import { failed, fromStatus, sent, type Sender } from './types';
import { msisdn } from './sms';

/**
 * WhatsApp senders.
 *
 * WhatsApp does not let a business send free text to someone who has not
 * messaged it in the last 24 hours: outside that window only a template Meta has
 * approved goes through. Every adapter here therefore needs a template name, and
 * says so plainly rather than failing with the provider's own error, which is
 * usually a number.
 */

function needsTemplate(): ReturnType<typeof failed> {
  return failed(
    'WhatsApp needs an approved template name outside the 24 hour window. Set one on the notification event.',
    true,
  );
}

export function aisensySender(values: Credentials): Sender {
  return {
    provider: 'aisensy',
    async send(message) {
      // AiSensy sends through a campaign rather than a raw template, and the
      // campaign is named on the connection, so an event without its own
      // template name still has something to send through.
      const campaign = message.templateName || values.campaignName;
      if (!campaign) return needsTemplate();

      const response = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey: values.apiKey,
          campaignName: campaign,
          destination: msisdn(message.to, true),
          userName: values.senderName ?? 'Academy',
          templateParams: message.variables ?? [],
        }),
      });

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);
      return sent(undefined, 0);
    },
  };
}

export function watiSender(values: Credentials): Sender {
  return {
    provider: 'wati',
    async send(message) {
      if (!message.templateName) return needsTemplate();

      const base = (values.endpoint ?? '').replace(/\/$/, '');
      const to = msisdn(message.to, true);

      const response = await fetch(
        `${base}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(to)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${values.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            template_name: message.templateName,
            broadcast_name: message.templateName,
            parameters: (message.variables ?? []).map((value, index) => ({
              name: String(index + 1),
              value,
            })),
          }),
        },
      );

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);
      return sent(undefined, 0);
    },
  };
}

export function gupshupSender(values: Credentials): Sender {
  return {
    provider: 'gupshup',
    async send(message) {
      const response = await fetch('https://api.gupshup.io/wa/api/v1/msg', {
        method: 'POST',
        headers: {
          apikey: values.apiKey,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          channel: 'whatsapp',
          source: values.sourceNumber,
          destination: msisdn(message.to, true),
          'src.name': values.appName,
          message: JSON.stringify({ type: 'text', text: message.body }),
        }),
      });

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);

      let id: string | undefined;
      try {
        id = (JSON.parse(text) as { messageId?: string }).messageId;
      } catch {
        /* ignore */
      }
      return sent(id, 0);
    },
  };
}

export function whatsappCloudSender(values: Credentials): Sender {
  return {
    provider: 'whatsapp_cloud',
    async send(message) {
      const to = msisdn(message.to, true);

      const payload = message.templateName
        ? {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: message.templateName,
              language: { code: values.templateLanguage || 'en_US' },
              components: (message.variables ?? []).length
                ? [
                    {
                      type: 'body',
                      parameters: (message.variables ?? []).map((text) => ({
                        type: 'text',
                        text,
                      })),
                    },
                  ]
                : [],
            },
          }
        : {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: message.body },
          };

      const response = await fetch(
        `https://graph.facebook.com/v21.0/${values.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${values.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);

      let id: string | undefined;
      try {
        id = (JSON.parse(text) as { messages?: { id?: string }[] }).messages?.[0]?.id;
      } catch {
        /* ignore */
      }
      return sent(id, 0);
    },
  };
}

export function interaktSender(values: Credentials): Sender {
  return {
    provider: 'interakt',
    async send(message) {
      if (!message.templateName) return needsTemplate();

      const response = await fetch('https://api.interakt.ai/v1/public/message/', {
        method: 'POST',
        headers: {
          authorization: `Basic ${values.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          countryCode: '+91',
          phoneNumber: msisdn(message.to, false),
          type: 'Template',
          template: {
            name: message.templateName,
            languageCode: 'en',
            bodyValues: message.variables ?? [],
          },
        }),
      });

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);
      return sent(undefined, 0);
    },
  };
}
