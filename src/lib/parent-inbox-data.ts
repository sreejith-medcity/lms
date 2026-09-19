import { db } from '@/lib/db';
import { childrenOf } from '@/lib/parent-session';
import { noticeCategory } from '@/lib/notices';

/**
 * The parent's inbox rows, for the web page and the app: one per alert,
 * naming the child and the kind, unread first. A row about a child whose
 * link has since been revoked keeps its line and loses its link.
 */

const KIND_CATEGORY: Record<string, string> = {
  'attendance.absent': 'Attendance',
  'attendance.late': 'Attendance',
  'attendance.corrected': 'Attendance',
  'result.published': 'Result',
  'fee.reminder': 'Fees',
};

export interface ParentInboxRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  noticeId: string | null;
  category: string;
  childIds: string[];
  children: string;
  createdAt: Date;
  read: boolean;
  withdrawn: boolean;
}

export async function parentInboxRows(organizationId: string, contact: string, take = 100): Promise<{ rows: ParentInboxRow[]; unread: number }> {
  const children = await childrenOf(organizationId, contact);
  const childName = new Map(children.map((c) => [c.id, c.name]));

  const rows = await db.parentNotification.findMany({
    where: { organizationId, contact },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take,
    select: { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true, learnerId: true, learnerIds: true, noticeId: true },
  });
  const noticeIds = rows.map((r) => r.noticeId).filter((x): x is string => Boolean(x));
  const notices = noticeIds.length ? await db.notice.findMany({ where: { organizationId, id: { in: noticeIds } }, select: { id: true, kind: true, status: true } }) : [];
  const noticeById = new Map(notices.map((n) => [n.id, n]));

  const list: ParentInboxRow[] = rows.map((r) => {
    const ids = r.learnerIds.length ? r.learnerIds : [r.learnerId];
    const linked = ids.filter((id) => childName.has(id));
    const notice = r.noticeId ? noticeById.get(r.noticeId) : null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: linked.length === 0 ? null : r.href,
      noticeId: r.noticeId,
      category: notice ? noticeCategory(notice.kind) : (KIND_CATEGORY[r.kind] ?? 'Notice'),
      childIds: linked,
      children: linked.length === 0 ? 'a child no longer on your account' : linked.map((id) => childName.get(id)).join(', '),
      createdAt: r.createdAt,
      read: r.readAt !== null,
      withdrawn: notice?.status === 'WITHDRAWN',
    };
  });
  return { rows: list, unread: list.filter((r) => !r.read).length };
}
