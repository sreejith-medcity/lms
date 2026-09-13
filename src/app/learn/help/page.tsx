import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { storageConfigured } from '@/lib/storage';
import { formatDateTime } from '@/lib/clock';
import { STATUS_LABEL, categoryLabel, statusTone, type HelpStatus } from '@/lib/help-desk';
import { Badge, Card } from '@/components/ui';
import { NewTicketForm } from './forms';
import { getTranslator } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help' };

/**
 * Help, from inside the portal. A question goes to the learner's branch as
 * a ticket, and the whole exchange stays here rather than in an inbox.
 */
export default async function HelpPage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tr = await getTranslator();

  const [tickets, enrolments] = await Promise.all([
    db.helpTicket.findMany({
      where: { organizationId: tenant.organizationId, userId: user.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      select: { id: true, subject: true, category: true, status: true, lastMessageAt: true, lastFromStaff: true, _count: { select: { messages: true } } },
    }),
    db.enrollment.findMany({
      where: { organizationId: tenant.organizationId, userId: user.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, product: { select: { title: true } }, batch: { select: { name: true } } },
    }),
  ]);

  const open = tickets.filter((t) => t.status === 'OPEN' || t.status === 'WAITING_ON_LEARNER');
  const done = tickets.filter((t) => t.status !== 'OPEN' && t.status !== 'WAITING_ON_LEARNER');

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <h1 className="text-xl font-semibold">{tr('Help')}</h1>
      <p className="t-small faint mt-1">{tr('Ask the office anything about your fees, classes or account. It goes to your branch and you will see the reply here and by email.')}</p>

      <div className="mt-6 space-y-6">
        <Card>
          <h2 className="t-heading">{tr('Ask something')}</h2>
          <div className="mt-4">
            <NewTicketForm enrolments={enrolments.map((e) => ({ id: e.id, label: `${e.product.title}${e.batch ? ` · ${e.batch.name}` : ''}` }))} uploads={storageConfigured()} />
          </div>
        </Card>

        {open.length > 0 && (
          <section>
            <h2 className="t-heading mb-3">{tr('Open')}</h2>
            <Card padded={false}>
              <ul className="divide-y">
                {open.map((t) => (
                  <TicketRow key={t.id} t={t} timezone={tenant.timezone} tr={tr} />
                ))}
              </ul>
            </Card>
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h2 className="t-heading mb-3">{tr('Earlier')}</h2>
            <Card padded={false}>
              <ul className="divide-y">
                {done.map((t) => (
                  <TicketRow key={t.id} t={t} timezone={tenant.timezone} tr={tr} />
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

type Tr = (text: string, vars?: Record<string, string | number>) => string;

function TicketRow({ t, timezone, tr }: { t: { id: string; subject: string; category: string; status: string; lastMessageAt: Date; lastFromStaff: boolean; _count: { messages: number } }; timezone: string; tr: Tr }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <Link href={`/learn/help/${t.id}`} className="font-medium hover:underline">{t.subject}</Link>
        <p className="t-small faint">
          {tr(categoryLabel(t.category))} · {t._count.messages} message{t._count.messages === 1 ? '' : 's'} · {t.lastFromStaff ? 'the office wrote' : 'you wrote'} {formatDateTime(t.lastMessageAt, timezone)}
        </p>
      </div>
      <Badge tone={statusTone(t.status)}>{tr(STATUS_LABEL[t.status as HelpStatus] ?? t.status)}</Badge>
    </li>
  );
}
