import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { dayKey } from '@/lib/clock';
import { questionsOf } from '@/lib/feedback';
import { describeDiscount } from '@/lib/promo';
import type { ReportDef } from './types';

/**
 * Feedback, marketing and trainers.
 *
 * The three places where a number is most often quoted without its denominator:
 * an average rating without a response rate, a campaign's reach without who it
 * could not reach, and a trainer's attendance without how many classes they
 * actually held.
 */

export const feedbackReports: ReportDef[] = [
  {
    id: 'feedback-by-form',
    title: 'Feedback forms',
    category: 'feedback',
    question: 'What is each form telling us, and is anybody answering it?',
    definitions: [
      ['Answers', 'Submissions on that form, all time.'],
      ['Average', 'The mean star rating on it. Answers with no rating are left out rather than counted as zero.'],
      ['Last answered', 'When the most recent submission arrived. A form nobody has answered in a month is a form nobody sees.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const forms = await db.feedbackForm.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          name: true,
          type: true,
          isActive: true,
          questions: true,
          responses: { select: { rating: true, createdAt: true } },
        },
      });

      return {
        columns: [
          { key: 'form', label: 'Form' },
          { key: 'about', label: 'About' },
          { key: 'state', label: 'State' },
          { key: 'questions', label: 'Questions', numeric: true },
          { key: 'answers', label: 'Answers', numeric: true },
          { key: 'average', label: 'Average', numeric: true },
          { key: 'last', label: 'Last answered' },
        ],
        rows: forms.map((f) => {
          const ratings = f.responses.map((r) => r.rating).filter((r): r is number => r != null);
          const last = f.responses.reduce<Date | null>(
            (latest, r) => (!latest || r.createdAt > latest ? r.createdAt : latest),
            null,
          );
          return [
            f.name,
            f.type.toLowerCase(),
            f.isActive ? 'open' : 'closed',
            questionsOf(f.questions).length,
            f.responses.length,
            ratings.length
              ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
              : '—',
            last ? dayKey(last, ctx.timeZone) : 'never',
          ];
        }),
      };
    },
  },

  {
    id: 'class-ratings',
    title: 'How classes were rated',
    category: 'feedback',
    question: 'Which classes did learners think were worth their evening?',
    definitions: [
      ['Rating', 'The mean of the star ratings left on that class.'],
      ['Answered', 'How many people rated it, out of how many signed in. A 5.0 from one person is not a 5.0.'],
    ],
    async run(ctx) {
      const responses = await db.feedbackResponse.findMany({
        where: {
          sessionId: { not: null },
          createdAt: { gte: ctx.since },
          session: { organizationId: ctx.organizationId },
        },
        select: {
          rating: true,
          session: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              batch: { select: { name: true } },
              attendances: { select: { status: true } },
            },
          },
        },
      });

      const bySession = new Map<
        string,
        { title: string; batch: string; when: Date; ratings: number[]; came: number }
      >();

      for (const r of responses) {
        if (!r.session) continue;
        const entry = bySession.get(r.session.id) ?? {
          title: r.session.title,
          batch: r.session.batch?.name ?? 'One to one',
          when: r.session.startsAt,
          ratings: [],
          came: r.session.attendances.filter(
            (a) => a.status === 'PRESENT' || a.status === 'LATE',
          ).length,
        };
        if (r.rating != null) entry.ratings.push(r.rating);
        bySession.set(r.session.id, entry);
      }

      const rows = [...bySession.values()]
        .map((s) => ({
          average: s.ratings.length ? s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length : 0,
          row: [
            dayKey(s.when, ctx.timeZone),
            s.title,
            s.batch,
            s.ratings.length
              ? (s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length).toFixed(1)
              : '—',
            `${s.ratings.length} of ${s.came}`,
          ],
        }))
        .sort((a, b) => a.average - b.average);

      return {
        columns: [
          { key: 'when', label: 'When' },
          { key: 'class', label: 'Class' },
          { key: 'batch', label: 'Batch' },
          { key: 'rating', label: 'Rating', numeric: true },
          { key: 'answered', label: 'Answered', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Lowest first. A class rated 3 by eleven people is worth more attention than one rated 2 by one.',
      };
    },
  },
];

export const marketingReports: ReportDef[] = [
  {
    id: 'promo-performance',
    title: 'Promo codes',
    category: 'marketing',
    question: 'What did each code cost us, and did it sell anything?',
    definitions: [
      ['Given away', 'The total discount claimed on that code.'],
      ['Claims', 'Redemptions recorded. A reservation released when a payment failed is not counted.'],
      ['Cost per claim', 'Given away over claims. Not a return: this report knows what a code cost, not what it earned.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const codes = await db.promoCode.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          code: true,
          discountType: true,
          discountValue: true,
          maxDiscountPaise: true,
          minOrderPaise: true,
          isActive: true,
          maxRedemptions: true,
          redemptions: { select: { amountPaise: true } },
        },
      });

      const rows = codes
        .map((c) => {
          const given = c.redemptions.reduce((n, r) => n + r.amountPaise, 0);
          return {
            given,
            row: [
              c.code,
              describeDiscount(c, ctx.currency),
              c.isActive ? 'on' : 'off',
              c.redemptions.length,
              c.maxRedemptions != null ? `${c.maxRedemptions}` : 'no cap',
              formatMoney(given, ctx.currency),
              c.redemptions.length
                ? formatMoney(Math.round(given / c.redemptions.length), ctx.currency)
                : '—',
            ],
          };
        })
        .sort((a, b) => b.given - a.given);

      return {
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'worth', label: 'Worth' },
          { key: 'state', label: 'State' },
          { key: 'claims', label: 'Claims', numeric: true },
          { key: 'cap', label: 'Cap', numeric: true },
          { key: 'given', label: 'Given away', numeric: true },
          { key: 'per', label: 'Cost per claim', numeric: true },
        ],
        rows: rows.map((r) => r.row),
      };
    },
  },

  {
    id: 'campaign-reach',
    title: 'Campaign reach',
    category: 'marketing',
    question: 'How many people would each campaign actually reach?',
    definitions: [
      ['Queued', 'Recipients resolved when the campaign was prepared, each with an address on its channel.'],
      ['Sent', 'Messages actually delivered to a provider. Zero everywhere until Phase 7 connects one.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const campaigns = await db.campaign.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
          name: true,
          channel: true,
          status: true,
          sentCount: true,
          createdAt: true,
          template: { select: { name: true } },
          _count: { select: { recipients: true } },
        },
      });

      return {
        columns: [
          { key: 'campaign', label: 'Campaign' },
          { key: 'channel', label: 'Channel' },
          { key: 'template', label: 'Template' },
          { key: 'state', label: 'State' },
          { key: 'queued', label: 'Queued', numeric: true },
          { key: 'sent', label: 'Sent', numeric: true },
          { key: 'created', label: 'Written' },
        ],
        rows: campaigns.map((c) => [
          c.name,
          c.channel.toLowerCase(),
          c.template?.name ?? '—',
          c.status.toLowerCase(),
          c._count.recipients,
          c.sentCount,
          dayKey(c.createdAt, ctx.timeZone),
        ]),
      };
    },
  },

  {
    id: 'referrals',
    title: 'Referrals',
    category: 'marketing',
    question: 'Is word of mouth actually bringing people who pay?',
    definitions: [
      ['Referred', 'People who signed up with somebody’s code.'],
      ['Bought', 'Of those, the ones who went on to pay for something. The gap is the number that matters.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const referrals = await db.referral.findMany({
        where: { referrer: { organizationId: ctx.organizationId } },
        select: {
          signedUpAt: true,
          purchasedAt: true,
          referrer: { select: { name: true } },
          referee: { select: { name: true } },
        },
      });

      const byReferrer = new Map<string, { total: number; bought: number }>();
      for (const r of referrals) {
        const entry = byReferrer.get(r.referrer.name) ?? { total: 0, bought: 0 };
        entry.total += 1;
        if (r.purchasedAt) entry.bought += 1;
        byReferrer.set(r.referrer.name, entry);
      }

      const bought = referrals.filter((r) => r.purchasedAt).length;

      return {
        columns: [
          { key: 'referrer', label: 'Referrer' },
          { key: 'referred', label: 'Referred', numeric: true },
          { key: 'bought', label: 'Bought', numeric: true },
          { key: 'rate', label: 'Conversion', numeric: true },
        ],
        rows: [...byReferrer.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([name, v]) => [
            name,
            v.total,
            v.bought,
            v.total ? `${Math.round((v.bought / v.total) * 100)}%` : '—',
          ]),
        stats: [
          { label: 'Referred', value: String(referrals.length) },
          {
            label: 'Went on to buy',
            value: referrals.length ? `${Math.round((bought / referrals.length) * 100)}%` : '—',
            sub: `${bought} of ${referrals.length}`,
          },
        ],
      };
    },
  },

  {
    id: 'lead-sources',
    title: 'Where enquiries come from',
    category: 'marketing',
    question: 'Which source produces enquiries that turn into learners?',
    definitions: [
      ['Enquiries', 'Leads recorded with that source in the window.'],
      ['Converted', 'Leads linked to a learner account. That link is made when somebody marks the enquiry as won.'],
    ],
    async run(ctx) {
      const leads = await db.lead.findMany({
        where: { organizationId: ctx.organizationId, createdAt: { gte: ctx.since } },
        select: { source: true, stage: true, convertedUserId: true },
      });

      const bySource = new Map<string, { total: number; won: number; converted: number }>();
      for (const l of leads) {
        const key = l.source ?? 'not recorded';
        const entry = bySource.get(key) ?? { total: 0, won: 0, converted: 0 };
        entry.total += 1;
        if (l.stage === 'WON') entry.won += 1;
        if (l.convertedUserId) entry.converted += 1;
        bySource.set(key, entry);
      }

      return {
        columns: [
          { key: 'source', label: 'Source' },
          { key: 'enquiries', label: 'Enquiries', numeric: true },
          { key: 'won', label: 'Marked won', numeric: true },
          { key: 'converted', label: 'Became a learner', numeric: true },
          { key: 'rate', label: 'Conversion', numeric: true },
        ],
        rows: [...bySource.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([source, v]) => [
            source.toLowerCase(),
            v.total,
            v.won,
            v.converted,
            v.total ? `${Math.round((v.converted / v.total) * 100)}%` : '—',
          ]),
      };
    },
  },

  {
    id: 'cart-recovery',
    title: 'Carts left behind',
    category: 'marketing',
    question: 'How much is sitting one step from a sale?',
    definitions: [
      ['Abandoned', 'A cart untouched for more than six hours with no payment against it.'],
      ['Value', 'List price of what was in it, before discount or tax. Not revenue.'],
      ['Visits', 'How many separate times they opened the payment screen.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const carts = await db.cart.findMany({
        where: { organizationId: ctx.organizationId, status: 'ABANDONED' },
        orderBy: { visitCount: 'desc' },
        take: 500,
        select: {
          visitCount: true,
          updatedAt: true,
          user: { select: { name: true, email: true, phone: true } },
          items: {
            select: {
              product: {
                select: {
                  title: true,
                  pricingPlans: {
                    where: { isActive: true },
                    take: 1,
                    orderBy: { sortOrder: 'asc' },
                    select: { pricePaise: true },
                  },
                },
              },
            },
          },
        },
      });

      const value = (c: (typeof carts)[number]) =>
        c.items.reduce((n, i) => n + (i.product.pricingPlans[0]?.pricePaise ?? 0), 0);

      return {
        columns: [
          { key: 'learner', label: 'Learner' },
          { key: 'contact', label: 'Contact' },
          { key: 'course', label: 'Looking at' },
          { key: 'value', label: 'Value', numeric: true },
          { key: 'visits', label: 'Visits', numeric: true },
          { key: 'quiet', label: 'Quiet since' },
        ],
        rows: carts.map((c) => [
          c.user?.name ?? 'A guest',
          c.user?.email ?? c.user?.phone ?? '—',
          c.items.map((i) => i.product.title).join('; ') || '—',
          formatMoney(value(c), ctx.currency),
          c.visitCount,
          dayKey(c.updatedAt, ctx.timeZone),
        ]),
        stats: [
          {
            label: 'On the table',
            value: formatMoney(
              carts.reduce((n, c) => n + value(c), 0),
              ctx.currency,
            ),
            sub: `${carts.length} carts`,
          },
        ],
      };
    },
  },
];
