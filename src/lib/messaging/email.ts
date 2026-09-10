import { createHash, createHmac } from 'node:crypto';

import type { Credentials } from '@/lib/integration-store';
import { asHtml } from './render';
import { failed, fromStatus, sent, type OutboundMessage, type Sender } from './types';

/**
 * Email senders.
 *
 * SMTP first, because it is the one an institute already has and the one that
 * works on the day the API provider's card expires. The HTTP providers are
 * better at deliverability reporting, which is why they are here too.
 */

function emailSender(provider: string, send: Sender['send']): Sender {
  return { provider, send };
}

export function smtpSender(values: Credentials): Sender {
  return emailSender('smtp', async (message: OutboundMessage) => {
    try {
      // nodemailer is CommonJS, so under ESM interop its exports may arrive on
      // the namespace or under `default` depending on how the bundler resolved
      // it. Checking both is three characters and avoids the failure that took
      // uploads down: a module that works in development and is undefined in
      // the production build.
      const imported = await import('nodemailer');
      const nodemailer =
        'createTransport' in imported
          ? imported
          : (imported as unknown as { default: typeof imported }).default;

      // One connection URL rather than five fields, because that is the shape
      // every host hands out and the shape SMTP_URL already has in hPanel.
      // smtps:// on 465 is implicit TLS; smtp:// on 587 starts plain and
      // upgrades, which is what Google Workspace expects.
      const transport = nodemailer.createTransport(values.url);

      const info = await transport.sendMail({
        from: values.fromName ? `"${values.fromName}" <${values.fromEmail}>` : values.fromEmail,
        to: message.to,
        subject: message.subject || '(no subject)',
        text: message.body,
        html: message.html ?? asHtml(message.body),
      });

      return sent(info.messageId, 0);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // A rejected recipient will be rejected again; a refused connection may not.
      const permanent = /550|553|recipient|no such user|mailbox unavailable/i.test(text);
      return failed(text, permanent);
    }
  });
}

export function resendSender(values: Credentials): Sender {
  return emailSender('resend', async (message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${values.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: values.fromEmail,
        to: [message.to],
        subject: message.subject || '(no subject)',
        text: message.body,
        html: message.html ?? asHtml(message.body),
      }),
    });

    const text = await response.text();
    if (!response.ok) return fromStatus(response.status, text);

    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { id?: string }).id;
    } catch {
      /* Resend answered 200 with something unexpected. The mail still went. */
    }
    return sent(id, 0);
  });
}

export function sendgridSender(values: Credentials): Sender {
  return emailSender('sendgrid', async (message) => {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${values.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: values.fromEmail },
        subject: message.subject || '(no subject)',
        content: [
          { type: 'text/plain', value: message.body },
          { type: 'text/html', value: message.html ?? asHtml(message.body) },
        ],
      }),
    });

    if (!response.ok) return fromStatus(response.status, await response.text());
    // SendGrid answers 202 with an empty body and the id in a header.
    return sent(response.headers.get('x-message-id') ?? undefined, 0);
  });
}

export function postmarkSender(values: Credentials): Sender {
  return emailSender('postmark', async (message) => {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': values.serverToken,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        From: values.fromEmail,
        To: message.to,
        Subject: message.subject || '(no subject)',
        TextBody: message.body,
        HtmlBody: message.html ?? asHtml(message.body),
        MessageStream: 'outbound',
      }),
    });

    const text = await response.text();
    if (!response.ok) return fromStatus(response.status, text);

    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { MessageID?: string }).MessageID;
    } catch {
      /* ignore */
    }
    return sent(id, 0);
  });
}

/**
 * Amazon SES.
 *
 * Signed here rather than through the AWS SDK, which would pull in a large
 * dependency tree for one POST. The signing is the same SigV4 the storage layer
 * already does for presigned URLs, with the body hashed because this request
 * actually has one.
 */
export function sesSender(values: Credentials): Sender {
  return emailSender('ses', async (message) => {
    const region = values.region || 'ap-south-1';
    const host = `email.${region}.amazonaws.com`;
    const path = '/v2/email/outbound-emails';

    const payload = JSON.stringify({
      FromEmailAddress: values.fromEmail,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject || '(no subject)', Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.body, Charset: 'UTF-8' },
            Html: { Data: message.html ?? asHtml(message.body), Charset: 'UTF-8' },
          },
        },
      },
    });

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/ses/aws4_request`;

    const payloadHash = createHash('sha256').update(payload, 'utf8').digest('hex');
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-date';

    const canonicalRequest = [
      'POST',
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const toSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
    ].join('\n');

    const sign = (key: Buffer | string, data: string) =>
      createHmac('sha256', key).update(data, 'utf8').digest();

    const signature = sign(
      sign(sign(sign(sign(`AWS4${values.secretAccessKey}`, dateStamp), region), 'ses'), 'aws4_request'),
      toSign,
    ).toString('hex');

    const response = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${values.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: payload,
    });

    const text = await response.text();
    if (!response.ok) return fromStatus(response.status, text);

    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { MessageId?: string }).MessageId;
    } catch {
      /* ignore */
    }
    return sent(id, 0);
  });
}
