import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { childrenOf } from '@/lib/parent-session';
import { childOverview } from '@/lib/parent-data';
import { attendanceNote, maskContact } from '@/lib/parents';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET → the children on this contact, each with the four figures a parent asks first, and the unread count. */
export async function GET(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { tenant, parent } = ctx;
  const children = await childrenOf(tenant.organizationId, parent.contact);
  const [overviews, unread] = await Promise.all([
    Promise.all(children.map((c) => childOverview(tenant.organizationId, c.id))),
    db.parentNotification.count({ where: { organizationId: tenant.organizationId, contact: parent.contact, readAt: null } }),
  ]);
  return ok({
    contact: maskContact(parent.contact),
    unread,
    children: children.map((c, i) => {
      const o = overviews[i];
      return {
        id: c.id,
        name: c.name,
        registrationNo: c.registrationNo,
        avatarUrl: c.avatarUrl,
        attendance: { percent: o.attendance.percent, note: attendanceNote(o.attendance), held: o.attendance.held, present: o.attendance.present, late: o.attendance.late, absent: o.attendance.absent },
        feesOpenPaise: o.feesOpenPaise,
        feesOverduePaise: o.feesOverduePaise,
        nextClassAt: o.nextClassAt?.toISOString() ?? null,
        latestMark: o.latestMark,
      };
    }),
  });
}
