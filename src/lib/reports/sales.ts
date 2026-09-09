import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { dayKey } from '@/lib/clock';
import type { ReportDef } from './types';

/**
 * Money, and who it came from.
 *
 * Nothing here is called revenue. Money that arrived is collections, money
 * promised is invoiced, and the gap between them is outstanding: three numbers
 * that an institute conflates at its peril.
 */

export const salesReports: ReportDef[] = [
  {
    id: 'collections-by-course',
    title: 'Collections by course',
    category: 'sales',
    question: 'Which courses actually brought money in?',
    definitions: [
      ['Collected', 'Captured payments against orders containing this course, in the window. Cash and cheques that cleared are included; a bounced cheque is not.'],
      ['Orders', 'Distinct paid orders, not enrolments: one order can carry one course.'],
    ],
    async run(ctx) {
      const items = await db.orderItem.findMany({
        where: {
          order: {
            organizationId: ctx.organizationId,
            status: 'PAID',
            placedAt: { gte: ctx.since },
          },
        },
        select: {
          totalPaise: true,
          titleSnapshot: true,
          productId: true,
          orderId: true,
        },
      });

      const byCourse = new Map<string, { title: string; paise: number; orders: Set<string> }>();
      for (const item of items) {
        const key = item.productId ?? item.titleSnapshot;
        const entry = byCourse.get(key) ?? {
          title: item.titleSnapshot,
          paise: 0,
          orders: new Set<string>(),
        };
        entry.paise += item.totalPaise;
        entry.orders.add(item.orderId);
        byCourse.set(key, entry);
      }

      const rows = [...byCourse.values()]
        .sort((a, b) => b.paise - a.paise)
        .map((c) => [
          c.title,
          c.orders.size,
          formatMoney(c.paise, ctx.currency),
          c.orders.size > 0 ? formatMoney(Math.round(c.paise / c.orders.size), ctx.currency) : '—',
        ]);

      const total = items.reduce((n, i) => n + i.totalPaise, 0);

      return {
        columns: [
          { key: 'course', label: 'Course' },
          { key: 'orders', label: 'Orders', numeric: true },
          { key: 'collected', label: 'Collected', numeric: true },
          { key: 'average', label: 'Average order', numeric: true },
        ],
        rows,
        stats: [
          { label: 'Collected', value: formatMoney(total, ctx.currency), sub: 'in this window' },
          { label: 'Courses that sold', value: String(rows.length) },
        ],
      };
    },
  },

  {
    id: 'collections-by-branch',
    title: 'Collections by branch',
    category: 'sales',
    question: 'Which branch is bringing the money in?',
    definitions: [
      ['Collected', 'Captured payments on orders placed against this branch in the window.'],
      ['Branch', 'The branch on the order, which is the one that sold it, not the one the learner attends.'],
    ],
    async run(ctx) {
      const orders = await db.order.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'PAID',
          placedAt: { gte: ctx.since },
        },
        select: { totalPaise: true, branch: { select: { id: true, name: true } } },
      });

      const byBranch = new Map<string, { name: string; paise: number; count: number }>();
      for (const o of orders) {
        const entry = byBranch.get(o.branch.id) ?? { name: o.branch.name, paise: 0, count: 0 };
        entry.paise += o.totalPaise;
        entry.count += 1;
        byBranch.set(o.branch.id, entry);
      }

      const total = orders.reduce((n, o) => n + o.totalPaise, 0);

      return {
        columns: [
          { key: 'branch', label: 'Branch' },
          { key: 'orders', label: 'Orders', numeric: true },
          { key: 'collected', label: 'Collected', numeric: true },
          { key: 'share', label: 'Share', numeric: true },
        ],
        rows: [...byBranch.values()]
          .sort((a, b) => b.paise - a.paise)
          .map((b) => [
            b.name,
            b.count,
            formatMoney(b.paise, ctx.currency),
            total > 0 ? `${Math.round((b.paise / total) * 100)}%` : '—',
          ]),
      };
    },
  },

  {
    id: 'enrolments-over-time',
    title: 'Enrolments by day',
    category: 'sales',
    question: 'Is enrolment speeding up or slowing down?',
    definitions: [
      ['Enrolments', 'Enrolment records created that day, whatever their status now. A cancelled enrolment still happened.'],
      ['Paid', 'Of those, the ones that came with an order that was paid.'],
    ],
    async run(ctx) {
      const enrolments = await db.enrollment.findMany({
        where: { organizationId: ctx.organizationId, createdAt: { gte: ctx.since } },
        select: { createdAt: true, orderItemId: true, source: true },
      });

      const byDay = new Map<string, { total: number; paid: number; admin: number }>();
      for (const e of enrolments) {
        const key = dayKey(e.createdAt, ctx.timeZone);
        const entry = byDay.get(key) ?? { total: 0, paid: 0, admin: 0 };
        entry.total += 1;
        if (e.orderItemId) entry.paid += 1;
        if (e.source !== 'SELF') entry.admin += 1;
        byDay.set(key, entry);
      }

      return {
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'total', label: 'Enrolments', numeric: true },
          { key: 'paid', label: 'With a paid order', numeric: true },
          { key: 'admin', label: 'Entered by the office', numeric: true },
        ],
        rows: [...byDay.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([day, v]) => [day, v.total, v.paid, v.admin]),
        stats: [
          { label: 'Enrolments', value: String(enrolments.length), sub: 'in this window' },
          {
            label: 'Sold online',
            value: `${enrolments.length ? Math.round((enrolments.filter((e) => e.source === 'SELF').length / enrolments.length) * 100) : 0}%`,
            sub: 'the rest were entered by staff',
          },
        ],
      };
    },
  },

  {
    id: 'unpaid-orders',
    title: 'Orders that never completed',
    category: 'sales',
    question: 'Who started paying and stopped?',
    definitions: [
      ['Pending', 'An order written when checkout opened, with no captured payment against it.'],
      ['Age', 'Days since the order was placed. Anything over a day is not going to complete on its own.'],
    ],
    async run(ctx) {
      const orders = await db.order.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ['PENDING', 'FAILED'] },
          placedAt: { gte: ctx.since },
        },
        orderBy: { placedAt: 'desc' },
        take: 500,
        select: {
          orderNo: true,
          status: true,
          totalPaise: true,
          placedAt: true,
          user: { select: { name: true, email: true } },
          items: { select: { titleSnapshot: true } },
        },
      });

      const now = Date.now();

      return {
        columns: [
          { key: 'order', label: 'Order' },
          { key: 'learner', label: 'Learner' },
          { key: 'course', label: 'Course' },
          { key: 'amount', label: 'Amount', numeric: true },
          { key: 'state', label: 'State' },
          { key: 'age', label: 'Days old', numeric: true },
        ],
        rows: orders.map((o) => [
          o.orderNo,
          `${o.user.name}${o.user.email ? ` (${o.user.email})` : ''}`,
          o.items[0]?.titleSnapshot ?? '—',
          formatMoney(o.totalPaise, ctx.currency),
          o.status.toLowerCase(),
          Math.floor((now - o.placedAt.getTime()) / 86_400_000),
        ]),
        stats: [
          {
            label: 'Left on the table',
            value: formatMoney(
              orders.reduce((n, o) => n + o.totalPaise, 0),
              ctx.currency,
            ),
            sub: `${orders.length} incomplete orders`,
          },
        ],
        note: 'These are orders, not carts. Somebody reached the payment screen and the money never arrived.',
      };
    },
  },

  {
    id: 'refunds',
    title: 'Refunds',
    category: 'sales',
    question: 'What went back out, and why?',
    definitions: [
      ['Refunded', 'The amount returned, whether through the gateway or recorded as paid back at the counter.'],
      ['Reason', 'What was typed when the refund was recorded. Gateway refunds carry the gateway’s own reason.'],
    ],
    async run(ctx) {
      const refunds = await db.refund.findMany({
        where: {
          payment: { organizationId: ctx.organizationId },
          createdAt: { gte: ctx.since },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          amountPaise: true,
          reason: true,
          status: true,
          createdAt: true,
          payment: { select: { gateway: true, order: { select: { orderNo: true } } } },
        },
      });

      return {
        columns: [
          { key: 'when', label: 'When' },
          { key: 'order', label: 'Order' },
          { key: 'amount', label: 'Refunded', numeric: true },
          { key: 'via', label: 'Through' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: refunds.map((r) => [
          dayKey(r.createdAt, ctx.timeZone),
          r.payment.order?.orderNo ?? '—',
          formatMoney(r.amountPaise, ctx.currency),
          r.payment.gateway.toLowerCase(),
          r.reason ?? '—',
        ]),
        stats: [
          {
            label: 'Refunded',
            value: formatMoney(
              refunds.reduce((n, r) => n + r.amountPaise, 0),
              ctx.currency,
            ),
            sub: `${refunds.length} refunds in this window`,
          },
        ],
      };
    },
  },

  {
    id: 'outstanding-fees',
    title: 'Overdue instalments',
    category: 'sales',
    question: 'Who owes us money, and how late is it?',
    definitions: [
      ['Overdue', 'An instalment whose due date has passed with nothing recorded against it.'],
      ['Days late', 'Days since the due date. Not since the enrolment.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const instalments = await db.instalment.findMany({
        where: {
          enrollment: { organizationId: ctx.organizationId },
          paidAt: null,
          dueDate: { lt: new Date() },
        },
        orderBy: { dueDate: 'asc' },
        take: 500,
        select: {
          amountPaise: true,
          dueDate: true,
          sequence: true,
          enrollment: {
            select: {
              user: { select: { name: true, phone: true, email: true } },
              product: { select: { title: true } },
            },
          },
        },
      });

      const now = Date.now();

      return {
        columns: [
          { key: 'learner', label: 'Learner' },
          { key: 'contact', label: 'Contact' },
          { key: 'course', label: 'Course' },
          { key: 'instalment', label: 'Instalment', numeric: true },
          { key: 'amount', label: 'Amount', numeric: true },
          { key: 'due', label: 'Was due' },
          { key: 'late', label: 'Days late', numeric: true },
        ],
        rows: instalments.map((i) => [
          i.enrollment.user.name,
          i.enrollment.user.phone ?? i.enrollment.user.email ?? '—',
          i.enrollment.product.title,
          i.sequence,
          formatMoney(i.amountPaise, ctx.currency),
          dayKey(i.dueDate, ctx.timeZone),
          Math.floor((now - i.dueDate.getTime()) / 86_400_000),
        ]),
        stats: [
          {
            label: 'Owed',
            value: formatMoney(
              instalments.reduce((n, i) => n + i.amountPaise, 0),
              ctx.currency,
            ),
            sub: `${instalments.length} instalments past their date`,
          },
        ],
        note: 'The whole book, not just this window: an instalment overdue since March is still overdue today.',
      };
    },
  },
];
