import type { Credentials } from '@/lib/integration-store';
import { failed, fromStatus, sent, type Sender } from './types';

/**
 * SMS senders.
 *
 * Every Indian one of these needs DLT registration to work at all, and none of
 * them say so clearly when it is missing: the API answers 200 and the message
 * disappears. So each adapter here treats a missing sender id or template id as
 * a permanent failure with a message that names DLT, rather than reporting
 * success and leaving somebody to work it out from an empty inbox.
 */

/** Indian numbers are stored many ways. Providers want one of two shapes. */
export function msisdn(raw: string, withCountryCode: boolean, defaultCode = '91'): string {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return withCountryCode ? `${defaultCode}${national}` : national;
}

export function msg91Sender(values: Credentials): Sender {
  return {
    provider: 'msg91',
    async send(message) {
      if (!values.dltTemplateId) {
        return failed(
          'MSG91 needs the DLT template id. Without it the API accepts the message and the carrier drops it.',
          true,
        );
      }

      const response = await fetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: values.authKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: values.dltTemplateId,
          sender: values.senderId,
          short_url: '0',
          recipients: [
            {
              mobiles: msisdn(message.to, true),
              // MSG91 flows take named variables that must match the approved
              // template, so the numbered ones are sent as var1, var2 and so on.
              ...Object.fromEntries(
                (message.variables ?? []).map((value, index) => [`var${index + 1}`, value]),
              ),
            },
          ],
        }),
      });

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);

      let id: string | undefined;
      let type: string | undefined;
      try {
        const parsed = JSON.parse(text) as { message?: string; type?: string };
        id = parsed.message;
        type = parsed.type;
      } catch {
        /* ignore */
      }
      // MSG91 answers 200 with type "error" for a bad template or sender.
      if (type === 'error') return failed(text.slice(0, 200), true);

      return sent(id, 0);
    },
  };
}

export function twilioSender(values: Credentials): Sender {
  return {
    provider: 'twilio',
    async send(message) {
      const auth = Buffer.from(`${values.accountSid}:${values.authToken}`).toString('base64');

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${values.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: `+${msisdn(message.to, true)}`,
            From: values.fromNumber,
            Body: message.body,
          }),
        },
      );

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);

      let id: string | undefined;
      try {
        id = (JSON.parse(text) as { sid?: string }).sid;
      } catch {
        /* ignore */
      }
      return sent(id, 0);
    },
  };
}

export function exotelSender(values: Credentials): Sender {
  return {
    provider: 'exotel',
    async send(message) {
      // Exotel authenticates with the account SID as the username. There is no
      // separate key on the card because their own dashboard does not show one.
      const auth = Buffer.from(`${values.accountSid}:${values.apiToken}`).toString('base64');

      const response = await fetch(
        `https://api.exotel.com/v1/Accounts/${values.accountSid}/Sms/send.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: values.callerId,
            To: msisdn(message.to, true),
            Body: message.body,
          }),
        },
      );

      const text = await response.text();
      if (!response.ok) return fromStatus(response.status, text);

      let id: string | undefined;
      try {
        id = (JSON.parse(text) as { SMSMessage?: { Sid?: string } }).SMSMessage?.Sid;
      } catch {
        /* ignore */
      }
      return sent(id, 0);
    },
  };
}

export function knowlaritySender(values: Credentials): Sender {
  return {
    provider: 'knowlarity',
    async send() {
      void values;
      return failed(
        'Knowlarity is set up for calls rather than SMS in this build, so nothing was sent.',
        true,
      );
    },
  };
}
