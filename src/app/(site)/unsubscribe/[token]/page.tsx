import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { UnsubscribeForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stop these messages', robots: { index: false, follow: false } };

/**
 * The page behind the link at the bottom of a marketing message.
 *
 * One button, no sign-in. A person who wants out should not have to
 * remember a password to get out, and a link that unsubscribes on being
 * opened is worse: mail scanners open links, and then nobody knows who
 * actually asked.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ token }, { c }] = await Promise.all([params, searchParams]);
  const tenant = await requireTenant();
  const channel = c === 'sms' ? 'sms' : c === 'whatsapp' ? 'whatsapp' : 'email';

  const person = await db.user.findFirst({
    where: { unsubscribeToken: token, organizationId: tenant.organizationId },
    select: { name: true, emailOptOut: true, smsOptOut: true, whatsappOptOut: true },
  });
  const already = person ? (channel === 'email' ? person.emailOptOut : channel === 'sms' ? person.smsOptOut : person.whatsappOptOut) : false;
  const noun = channel === 'email' ? 'emails' : channel === 'sms' ? 'SMS messages' : 'WhatsApp messages';

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <h1 className="text-2xl font-bold">Stop promotional {noun}?</h1>
      {!person ? (
        <p className="muted mt-3 leading-relaxed">
          This link is not one we recognise. If you have an account, sign in and change what you receive under Account.
        </p>
      ) : already ? (
        <p className="muted mt-3 leading-relaxed">
          Already done, {person.name.split(' ')[0]}. You will not get promotional {noun} from {tenant.name}. Receipts, class reminders and
          sign-in codes still come, because you would want them.
        </p>
      ) : (
        <>
          <p className="muted mt-3 leading-relaxed">
            {person.name.split(' ')[0]}, this stops campaigns and reminders about courses from {tenant.name} by this channel. Receipts,
            class reminders and sign-in codes still come. You can switch it back on any time under Account.
          </p>
          <div className="mt-6">
            <UnsubscribeForm token={token} channel={channel} />
          </div>
        </>
      )}
    </div>
  );
}
