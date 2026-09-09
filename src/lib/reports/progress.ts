import { db } from '@/lib/db';
import { dayKey } from '@/lib/clock';
import type { ReportDef } from './types';

/**
 * Whether people are actually getting through the course.
 *
 * Progress is the figure an institute is proudest of and least careful with, so
 * every number here says what it divides by. "Completion" against a curriculum
 * a batch was never given is not completion.
 */

export const progressReports: ReportDef[] = [
  {
    id: 'batch-progress',
    title: 'Progress by batch',
    category: 'progress',
    question: 'Which batches are moving, and which have stalled?',
    definitions: [
      ['Average progress', 'The mean of every enrolment’s progress in that batch, counted against the curriculum the batch was actually given.'],
      ['Stalled', 'Enrolments with no recorded activity in fourteen days. Somebody who finished is not stalled.'],
    ],
    ignoresRange: true,
    async run() {
      const batches = await db.batch.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          course: { select: { product: { select: { title: true } } } },
          enrollments: {
            select: { progressPercent: true, lastActivityAt: true, status: true },
          },
        },
      });

      const stale = new Date(Date.now() - 14 * 86_400_000);

      const rows = batches
        .filter((b) => b.enrollments.length > 0)
        .map((b) => {
          const average =
            b.enrollments.reduce((n, e) => n + e.progressPercent, 0) / b.enrollments.length;
          const stalled = b.enrollments.filter(
            (e) =>
              e.progressPercent < 100 &&
              e.status !== 'COMPLETED' &&
              (!e.lastActivityAt || e.lastActivityAt < stale),
          ).length;
          const done = b.enrollments.filter((e) => e.progressPercent >= 100).length;

          return {
            row: [
              b.name,
              b.course.product.title,
              b.status.toLowerCase(),
              b.enrollments.length,
              `${Math.round(average)}%`,
              done,
              stalled,
            ],
            average,
          };
        })
        .sort((a, b) => a.average - b.average);

      return {
        columns: [
          { key: 'batch', label: 'Batch' },
          { key: 'course', label: 'Course' },
          { key: 'state', label: 'State' },
          { key: 'learners', label: 'Learners', numeric: true },
          { key: 'average', label: 'Average progress', numeric: true },
          { key: 'finished', label: 'Finished', numeric: true },
          { key: 'stalled', label: 'Stalled', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Worst first, because that is the list worth acting on.',
      };
    },
  },

  {
    id: 'course-dropoff',
    title: 'Where people stop',
    category: 'progress',
    question: 'Which lesson is losing us learners?',
    definitions: [
      ['Reached', 'Learners with any progress recorded against that lesson, complete or not.'],
      ['Finished', 'Learners who marked it done or watched it through.'],
      ['Drop', 'The share of people who reached this lesson and did not finish it. A high drop on one lesson is usually the lesson, not the learners.'],
    ],
    ignoresRange: true,
    async run() {
      const materials = await db.material.findMany({
        select: {
          id: true,
          title: true,
          section: {
            select: {
              title: true,
              module: {
                select: {
                  name: true,
                  courses: {
                    take: 1,
                    select: { course: { select: { product: { select: { title: true } } } } },
                  },
                },
              },
            },
          },
          progress: { select: { completedAt: true } },
        },
      });

      const rows = materials
        .filter((m) => m.progress.length >= 3)
        .map((m) => {
          const reached = m.progress.length;
          const finished = m.progress.filter((p) => p.completedAt).length;
          const drop = Math.round(((reached - finished) / reached) * 100);
          return {
            drop,
            row: [
              m.section.module.courses[0]?.course.product.title ?? '—',
              m.section.module.name,
              m.title,
              reached,
              finished,
              `${drop}%`,
            ],
          };
        })
        .sort((a, b) => b.drop - a.drop)
        .slice(0, 100);

      return {
        columns: [
          { key: 'course', label: 'Course' },
          { key: 'module', label: 'Module' },
          { key: 'lesson', label: 'Lesson' },
          { key: 'reached', label: 'Reached', numeric: true },
          { key: 'finished', label: 'Finished', numeric: true },
          { key: 'drop', label: 'Drop', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Only lessons at least three people reached, since one person stopping is not a pattern.',
      };
    },
  },

  {
    id: 'never-started',
    title: 'Enrolled and never started',
    category: 'progress',
    question: 'Who paid and never turned up?',
    definitions: [
      ['Never started', 'An active enrolment with no lesson progress and no attendance at all.'],
      ['Days since', 'Days since they enrolled. The first week is where this is still recoverable.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const enrolments = await db.enrollment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ['ENROLLED', 'REGISTERED'] },
          progressPercent: 0,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          createdAt: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
          product: { select: { title: true } },
          batch: { select: { name: true } },
        },
      });

      const attended = await db.attendance.findMany({
        where: {
          userId: { in: enrolments.map((e) => e.user.id) },
          status: { in: ['PRESENT', 'LATE'] },
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      const came = new Set(attended.map((a) => a.userId));

      const now = Date.now();
      const cold = enrolments.filter((e) => !came.has(e.user.id));

      return {
        columns: [
          { key: 'learner', label: 'Learner' },
          { key: 'contact', label: 'Contact' },
          { key: 'course', label: 'Course' },
          { key: 'batch', label: 'Batch' },
          { key: 'enrolled', label: 'Enrolled' },
          { key: 'days', label: 'Days since', numeric: true },
        ],
        rows: cold.map((e) => [
          e.user.name,
          e.user.phone ?? e.user.email ?? '—',
          e.product.title,
          e.batch?.name ?? '—',
          dayKey(e.createdAt, ctx.timeZone),
          Math.floor((now - e.createdAt.getTime()) / 86_400_000),
        ]),
        stats: [
          { label: 'Never started', value: String(cold.length), sub: 'no lessons, no attendance' },
        ],
      };
    },
  },

  {
    id: 'certificates',
    title: 'Certificates issued',
    category: 'progress',
    question: 'Who finished, and can it be checked?',
    definitions: [
      ['Serial', 'The sequential number on the certificate. Gaps mean a withdrawal, not a mistake.'],
      ['Withdrawn', 'Revoked after issue. The record stays; the certificate stops verifying.'],
    ],
    async run(ctx) {
      const certificates = await db.issuedCertificate.findMany({
        where: {
          enrollment: { organizationId: ctx.organizationId },
          issuedAt: { gte: ctx.since },
        },
        orderBy: { issuedAt: 'desc' },
        take: 500,
        select: {
          serialNo: true,
          issuedAt: true,
          revokedAt: true,
          enrollment: {
            select: {
              user: { select: { name: true } },
              product: { select: { title: true } },
            },
          },
        },
      });

      return {
        columns: [
          { key: 'serial', label: 'Serial' },
          { key: 'learner', label: 'Learner' },
          { key: 'course', label: 'Course' },
          { key: 'issued', label: 'Issued' },
          { key: 'state', label: 'State' },
        ],
        rows: certificates.map((c) => [
          c.serialNo,
          c.enrollment?.user.name ?? '—',
          c.enrollment?.product.title ?? '—',
          dayKey(c.issuedAt, ctx.timeZone),
          c.revokedAt ? 'withdrawn' : 'valid',
        ]),
        stats: [
          { label: 'Issued', value: String(certificates.length), sub: 'in this window' },
          {
            label: 'Withdrawn',
            value: String(certificates.filter((c) => c.revokedAt).length),
          },
        ],
      };
    },
  },
];
