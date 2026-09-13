import { db } from '@/lib/db';
import { curriculumGate } from '@/lib/curriculum-access';
import { MATERIAL_LABELS, percent } from '@/lib/progress';
import { balanceOf, summariseAccount } from '@/lib/dues';
import { feeStatusLabel } from '@/lib/misc-fees';
import { learnerNav } from '@/lib/learner-nav';
import { settingBool, settingText } from '@/lib/settings/store';
import { offeredLocales } from '@/lib/i18n';
import { streakFor, learnerStats } from '@/lib/badges-data';
import { currentStreak, standings } from '@/lib/badges';
import { dayKey } from '@/lib/clock';
import type { TenantContext } from '@/lib/tenant';
import type { ApiUser } from './auth';

/**
 * What the app reads. Each function returns plain JSON-able objects with
 * ISO dates and paise, and reads only what the signed-in learner owns.
 * The same libraries the web pages use decide locks, progress and dues,
 * so the two never disagree.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function tenantPublic(tenant: TenantContext) {
  const [org, languages, otp, selfSignup] = await Promise.all([
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, logoUrl: true, faviconUrl: true, brandColor: true, supportEmail: true, contactNumber: true, website: true } }),
    settingText(tenant.organizationId, 'learning.languages'),
    settingBool(tenant.organizationId, 'auth.otpLogin'),
    settingBool(tenant.organizationId, 'auth.selfSignup'),
  ]);
  return {
    name: org?.name ?? tenant.name,
    slug: tenant.slug,
    logoUrl: org?.logoUrl ?? null,
    faviconUrl: org?.faviconUrl ?? null,
    brandColor: org?.brandColor ?? tenant.brandColor,
    currency: tenant.currency,
    timezone: tenant.timezone,
    supportEmail: org?.supportEmail ?? null,
    phone: org?.contactNumber ?? null,
    website: org?.website ?? null,
    languages: offeredLocales(languages),
    signIn: { password: true, code: otp, selfSignup },
    status: tenant.status,
  };
}

export async function meProfile(tenant: TenantContext, user: ApiUser) {
  const [nav, unread, badgesOn] = await Promise.all([
    learnerNav(tenant.organizationId),
    db.notificationLog.count({ where: { organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: 'SENT' } }),
    settingBool(tenant.organizationId, 'learning.badges'),
  ]);
  const streak = badgesOn ? await streakFor(tenant.organizationId, user.id) : null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    kind: user.kind,
    locale: user.locale,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    nav: nav.map((n) => n.key),
    unreadNotifications: unread,
    streakDays: streak ? currentStreak(streak, dayKey(new Date(), tenant.timezone)) : 0,
  };
}

const courseSelect = {
  id: true,
  status: true,
  progressPercent: true,
  lastActivityAt: true,
  createdAt: true,
  expiresAt: true,
  batch: { select: { id: true, name: true, startDate: true, endDate: true } },
  product: { select: { id: true, title: true, slug: true, course: { select: { id: true, thumbnailAssetId: true, level: true, language: true, durationMinutes: true } } } },
} as const;

export async function myCourses(tenant: TenantContext, user: ApiUser) {
  const rows = await db.enrollment.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    select: courseSelect,
  });
  return rows.map((e) => ({
    enrollmentId: e.id,
    productId: e.product.id,
    title: e.product.title,
    slug: e.product.slug,
    thumbnailUrl: e.product.course?.thumbnailAssetId ? `/api/assets/${e.product.course.thumbnailAssetId}` : null,
    level: e.product.course?.level ?? null,
    language: e.product.course?.language ?? null,
    status: e.status,
    progressPercent: Math.round(e.progressPercent),
    lastActivityAt: iso(e.lastActivityAt),
    enrolledAt: e.createdAt.toISOString(),
    expiresAt: iso(e.expiresAt),
    batch: e.batch ? { id: e.batch.id, name: e.batch.name, startDate: iso(e.batch.startDate), endDate: iso(e.batch.endDate) } : null,
  }));
}

export async function courseDetail(tenant: TenantContext, user: ApiUser, productId: string) {
  const enrollment = await db.enrollment.findFirst({
    where: { organizationId: tenant.organizationId, userId: user.id, productId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    select: {
      id: true, batchId: true, createdAt: true, progressPercent: true,
      product: {
        select: {
          id: true, title: true,
          course: {
            select: {
              id: true, description: true,
              modules: { orderBy: { sortOrder: 'asc' }, select: { module: { select: { id: true, name: true, sections: { where: { isVisible: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, materials: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, type: true, durationSeconds: true, isFreePreview: true, isDownloadable: true, assetId: true } } } } } } } },
            },
          },
        },
      },
    },
  });
  if (!enrollment?.product.course) return null;
  const course = enrollment.product.course;
  const gate = await curriculumGate({ courseId: course.id, enrolledAt: enrollment.createdAt, batchId: enrollment.batchId });
  const progress = await db.materialProgress.findMany({ where: { userId: user.id, enrollmentId: enrollment.id }, select: { materialId: true, completedAt: true, positionSeconds: true, percent: true } });
  const byMaterial = new Map(progress.map((p) => [p.materialId, p]));
  const modules = course.modules
    .filter(({ module }) => gate.teaches(module.id))
    .map(({ module }) => ({
      id: module.id,
      name: module.name,
      sections: module.sections.map((s) => ({
        id: s.id,
        title: s.title,
        lessons: s.materials.map((m) => {
          const p = byMaterial.get(m.id);
          const lock = gate.lockOf(m.id, s.id);
          return {
            id: m.id,
            title: m.title,
            type: m.type,
            typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
            durationSeconds: m.durationSeconds,
            downloadable: m.isDownloadable,
            completed: Boolean(p?.completedAt),
            positionSeconds: p?.positionSeconds ?? 0,
            percent: Math.round(p?.percent ?? 0),
            locked: lock ? { until: lock.until.toISOString(), label: lock.label } : null,
          };
        }),
      })),
    }));
  const all = modules.flatMap((m) => m.sections.flatMap((s) => s.lessons));
  const completed = all.filter((l) => l.completed).length;
  const resume = all.find((l) => !l.completed && !l.locked) ?? null;
  return {
    enrollmentId: enrollment.id,
    productId: enrollment.product.id,
    title: enrollment.product.title,
    description: course.description,
    progressPercent: percent(completed, all.length),
    lessonsDone: completed,
    lessonsTotal: all.length,
    resumeLessonId: resume?.id ?? null,
    modules,
  };
}

export async function upcomingClasses(tenant: TenantContext, user: ApiUser, days = 14) {
  const now = new Date();
  const to = new Date(now.getTime() + days * 864e5);
  const enrolments = await db.enrollment.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, status: { in: ['REGISTERED', 'ENROLLED', 'ON_LEAVE', 'COMPLETED'] }, batchId: { not: null } }, select: { batchId: true, product: { select: { title: true } } } });
  const batchIds = enrolments.map((e) => e.batchId).filter((x): x is string => Boolean(x));
  const sessions = await db.liveSession.findMany({
    where: { organizationId: tenant.organizationId, status: { in: ['SCHEDULED', 'LIVE'] }, isHoliday: false, endsAt: { gte: now }, startsAt: { lte: to }, OR: [{ batchId: { in: batchIds } }, { learnerId: user.id }] },
    orderBy: { startsAt: 'asc' },
    take: 50,
    select: { id: true, title: true, topics: true, startsAt: true, endsAt: true, status: true, provider: true, batch: { select: { id: true, name: true } }, learnerId: true, instructors: { select: { instructor: { select: { user: { select: { name: true } } } } } } },
  });
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    topics: s.topics,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status,
    live: s.status === 'LIVE',
    provider: s.provider,
    batch: s.batch ? { id: s.batch.id, name: s.batch.name } : null,
    oneToOne: Boolean(s.learnerId),
    trainers: s.instructors.map((i) => i.instructor.user.name),
  }));
}

export async function feesSummary(tenant: TenantContext, user: ApiUser) {
  const now = new Date();
  const [plans, charges, receipts] = await Promise.all([
    db.enrollment.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, instalments: { some: {} } }, orderBy: { createdAt: 'desc' }, select: { id: true, product: { select: { title: true } }, instalments: { orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } } } }),
    db.miscFee.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, status: { in: ['PENDING', 'PAID'] } }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 40, select: { id: true, label: true, amountPaise: true, dueDate: true, status: true, paidAt: true, enrollment: { select: { product: { select: { title: true } } } } } }),
    db.payment.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, receiptNo: { not: null }, status: 'CAPTURED' }, orderBy: { capturedAt: 'desc' }, take: 30, select: { receiptNo: true, amountPaise: true, capturedAt: true, createdAt: true, method: true, raw: true } }),
  ]);
  return {
    currency: tenant.currency,
    plans: plans.map((p) => {
      const s = summariseAccount(p.instalments, now);
      const next = p.instalments.find((i) => balanceOf(i) > 0) ?? null;
      return {
        enrollmentId: p.id,
        course: p.product.title,
        totalPaise: s.totalPaise,
        paidPaise: s.paidPaise,
        balancePaise: s.balancePaise,
        overduePaise: s.overduePaise,
        settled: s.settled,
        payNext: next ? { instalmentId: next.id, sequence: next.sequence, balancePaise: balanceOf(next), dueDate: next.dueDate.toISOString(), webPath: '/learn/fees' } : null,
        instalments: p.instalments.map((i) => ({ id: i.id, sequence: i.sequence, amountPaise: i.amountPaise, paidPaise: i.paidPaise, balancePaise: balanceOf(i), dueDate: i.dueDate.toISOString(), paidAt: iso(i.paidAt) })),
      };
    }),
    charges: charges.map((c) => ({ id: c.id, label: c.label, course: c.enrollment.product.title, amountPaise: c.amountPaise, dueDate: iso(c.dueDate), status: c.status, statusLabel: feeStatusLabel(c, now).text, paidAt: iso(c.paidAt), webPath: '/learn/fees' })),
    receipts: receipts.map((r) => ({ receiptNo: r.receiptNo, amountPaise: r.amountPaise, at: (r.capturedAt ?? r.createdAt).toISOString(), method: r.method, item: ((r.raw ?? {}) as { item?: string }).item ?? null, webPath: `/learn/receipts/${r.receiptNo}` })),
  };
}

export async function notificationList(tenant: TenantContext, user: ApiUser, limit = 50) {
  const rows = await db.notificationLog.findMany({
    where: { organizationId: tenant.organizationId, userId: user.id, channel: 'IN_APP', status: { in: ['SENT', 'READ'] } },
    orderBy: { sentAt: 'desc' },
    take: Math.min(200, limit),
    select: { id: true, eventKey: true, status: true, sentAt: true, createdAt: true, context: true },
  });
  return rows.map((r) => {
    const c = (r.context ?? {}) as Record<string, string>;
    return { id: r.id, event: r.eventKey, title: c._renderedSubject || r.eventKey, body: c._renderedBody || '', path: typeof c.url === 'string' && c.url.startsWith('/') ? c.url : null, unread: r.status === 'SENT', at: (r.sentAt ?? r.createdAt).toISOString() };
  });
}

export async function badgesSummary(tenant: TenantContext, user: ApiUser) {
  const on = await settingBool(tenant.organizationId, 'learning.badges');
  if (!on) return { enabled: false, streak: null, badges: [] };
  const now = new Date();
  const [stats, streak, held] = await Promise.all([
    learnerStats(tenant.organizationId, user.id, tenant.timezone, now),
    streakFor(tenant.organizationId, user.id),
    db.badgeAward.findMany({ where: { organizationId: tenant.organizationId, userId: user.id }, select: { badgeKey: true, tier: true, awardedAt: true } }),
  ]);
  return {
    enabled: true,
    streak: { current: currentStreak(streak, dayKey(now, tenant.timezone)), longest: streak.longest, recentDays: streak.recentDays },
    badges: standings(stats, held).map((r) => ({ key: r.def.key, name: r.def.name, emoji: r.def.emoji, how: r.def.how, unit: r.def.unit, tier: r.tier, value: r.value, next: r.next, percent: r.percent, awardedAt: iso(r.awardedAt) })),
  };
}
