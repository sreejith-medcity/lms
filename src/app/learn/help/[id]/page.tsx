import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { storageConfigured } from '@/lib/storage';
import { STATUS_LABEL, categoryLabel, statusTone, type HelpStatus } from '@/lib/help-desk';
import { Badge, Card } from '@/components/ui';
import { Thread } from '../thread';
import { CloseTicketButton, LearnerReplyForm } from '../forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const t = await db.helpTicket.findFirst({
    where: { id, organizationId: tenant.organizationId, userId: user.id },
    select: {
      id: true, subject: true, category: true, status: true, createdAt: true,
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, fromStaff: true, body: true, attachmentIds: true, createdAt: true, authorId: true } },
    },
  });
  if (!t) notFound();

  const authorIds = Array.from(new Set(t.messages.map((m) => m.authorId).filter((x): x is string => Boolean(x))));
  const assetIds = t.messages.flatMap((m) => m.attachmentIds);
  const [authors, assets] = await Promise.all([
    db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: authorIds } }, select: { id: true, name: true } }),
    assetIds.length ? db.asset.findMany({ where: { organizationId: tenant.organizationId, id: { in: assetIds } }, select: { id: true, fileName: true } }) : Promise.resolve([]),
  ]);
  const names = new Map(authors.map((a) => [a.id, a.name]));
  const attachments = new Map(assets.map((a) => [a.id, { fileName: a.fileName }]));

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Link href="/learn/help" className="t-small faint hover:underline">Help</Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.subject}</h1>
          <p className="t-small faint mt-1">{categoryLabel(t.category)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(t.status)}>{STATUS_LABEL[t.status as HelpStatus] ?? t.status}</Badge>
          {t.status !== 'CLOSED' && <CloseTicketButton ticketId={t.id} />}
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <Thread messages={t.messages.map((m) => ({ ...m, authorName: m.authorId ? names.get(m.authorId) ?? null : null }))} timezone={tenant.timezone} viewer="learner" attachments={attachments} />
        <Card>
          <LearnerReplyForm ticketId={t.id} closed={t.status === 'CLOSED'} uploads={storageConfigured()} />
        </Card>
      </div>
    </div>
  );
}
