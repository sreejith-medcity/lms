import { db } from '@/lib/db';

/**
 * Everything the academy holds on one learner, as one JSON document.
 *
 * Written for the person reading it rather than for a machine: plain keys,
 * dates as ISO strings, related things named rather than referenced by id.
 * It is the answer to "what do you have on me", so it errs on the side of
 * including things.
 */
export async function buildDataExport(organizationId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      username: true,
      dateOfBirth: true,
      gender: true,
      timezone: true,
      locale: true,
      status: true,
      emailOptOut: true,
      smsOptOut: true,
      whatsappOptOut: true,
      registrationNo: true,
      lastSeenAt: true,
      createdAt: true,
      learnerProfile: true,
      customFieldValues: { select: { value: true, definition: { select: { label: true, key: true } } } },
      organization: { select: { name: true } },
    },
  });
  if (!user) return null;

  const [enrollments, progress, attendances, attempts, submissions, assignments, notes, questions, certificates, orders, notifications, testimonials, reportCards, sessions, aiConversations, requests] =
    await Promise.all([
      db.enrollment.findMany({
        where: { userId, organizationId },
        select: {
          status: true,
          progressPercent: true,
          createdAt: true,
          startsAt: true,
          expiresAt: true,
          completedAt: true,
          product: { select: { title: true } },
          batch: { select: { name: true } },
          instalments: { select: { sequence: true, amountPaise: true, dueDate: true, paidPaise: true, paidAt: true } },
        },
      }),
      db.materialProgress.findMany({
        where: { userId, user: { organizationId } },
        select: { completedAt: true, positionSeconds: true, isBookmarked: true, material: { select: { title: true } } },
      }),
      db.attendance.findMany({
        where: { userId, user: { organizationId } },
        select: { status: true, session: { select: { title: true, startsAt: true } } },
      }),
      db.attempt.findMany({
        where: { userId, user: { organizationId } },
        select: { attemptNo: true, status: true, startedAt: true, submittedAt: true, scorePercent: true, passed: true, assessment: { select: { title: true } } },
      }),
      db.submission.findMany({
        where: { userId, user: { organizationId } },
        select: { status: true, score: true, submittedAt: true, feedback: true, attempt: { select: { assessment: { select: { title: true } } } } },
      }),
      db.assignmentSubmission.findMany({
        where: { userId, organizationId },
        select: { attemptNo: true, status: true, submittedAt: true, marks: true, feedback: true, text: true, assignment: { select: { title: true } } },
      }),
      db.learnerNote.findMany({ where: { userId, user: { organizationId } }, select: { body: true, atSeconds: true, createdAt: true, material: { select: { title: true } } } }),
      db.lessonQuestion.findMany({ where: { userId, organizationId }, select: { body: true, answer: true, createdAt: true, answeredAt: true, material: { select: { title: true } } } }),
      db.issuedCertificate.findMany({
        where: { userId, user: { organizationId } },
        select: { serialNo: true, issuedAt: true, expiresAt: true, revokedAt: true, verifyToken: true, template: { select: { name: true } } },
      }),
      db.order.findMany({
        where: { userId, organizationId },
        select: {
          orderNo: true,
          status: true,
          currency: true,
          subtotalPaise: true,
          discountPaise: true,
          taxPaise: true,
          totalPaise: true,
          placedAt: true,
          billingAddress: true,
          items: { select: { pricePaise: true, product: { select: { title: true } } } },
          invoice: { select: { invoiceNo: true } },
          payments: { select: { gateway: true, method: true, amountPaise: true, status: true, capturedAt: true } },
        },
      }),
      db.notificationLog.findMany({
        where: { userId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { channel: true, eventKey: true, status: true, createdAt: true, target: true },
      }),
      db.testimonial.findMany({ where: { userId, organizationId }, select: { rating: true, comment: true, isPublished: true, createdAt: true, product: { select: { title: true } } } }),
      db.reportCard.findMany({ where: { userId, organizationId }, select: { title: true, issuedAt: true, enrollment: { select: { product: { select: { title: true } } } } } }),
      db.authSession.findMany({ where: { userId, user: { organizationId } }, select: { ip: true, userAgent: true, createdAt: true, expiresAt: true } }),
      db.aiConversation.findMany({ where: { userId, user: { organizationId } }, select: { title: true, createdAt: true } }),
      db.dataRequest.findMany({ where: { userId, organizationId }, select: { kind: true, status: true, reason: true, note: true, createdAt: true, handledAt: true } }),
    ]);

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const money = (paise: number, currency = 'INR') => `${currency} ${(paise / 100).toFixed(2)}`;

  return {
    exportedAt: new Date().toISOString(),
    academy: user.organization.name,
    about: 'Everything this academy holds about you, as of the time above. Money is shown in whole currency units.',
    profile: {
      name: user.name,
      email: user.email,
      phone: user.phone,
      username: user.username,
      dateOfBirth: iso(user.dateOfBirth),
      gender: user.gender,
      timezone: user.timezone,
      language: user.locale,
      status: user.status,
      registrationNo: user.registrationNo,
      memberSince: iso(user.createdAt),
      lastSeen: iso(user.lastSeenAt),
      marketing: {
        email: user.emailOptOut ? 'opted out' : 'allowed',
        sms: user.smsOptOut ? 'opted out' : 'allowed',
        whatsapp: user.whatsappOptOut ? 'opted out' : 'allowed',
      },
      details: user.learnerProfile
        ? {
            occupation: user.learnerProfile.occupation,
            schoolOrCollege: user.learnerProfile.schoolOrCollege,
            standard: user.learnerProfile.standard,
            area: user.learnerProfile.area,
            parentName: user.learnerProfile.parentName,
            parentPhone: user.learnerProfile.parentPhone,
            parentEmail: user.learnerProfile.parentEmail,
            alternatePhone: user.learnerProfile.alternatePhone,
            permanentAddress: user.learnerProfile.permanentAddress,
            residentialAddress: user.learnerProfile.residentialAddress,
            source: user.learnerProfile.source,
          }
        : null,
      extraFields: user.customFieldValues.map((v) => ({ field: v.definition.label, value: v.value })),
    },
    enrolments: enrollments.map((e) => ({
      course: e.product.title,
      batch: e.batch?.name ?? null,
      status: e.status,
      progressPercent: e.progressPercent,
      enrolledAt: iso(e.createdAt),
      startsAt: iso(e.startsAt),
      expiresAt: iso(e.expiresAt),
      completedAt: iso(e.completedAt),
      instalments: e.instalments.map((i) => ({ sequence: i.sequence, amount: money(i.amountPaise), dueDate: iso(i.dueDate), paid: money(i.paidPaise), paidAt: iso(i.paidAt) })),
    })),
    lessons: progress.map((p) => ({ lesson: p.material.title, completedAt: iso(p.completedAt), resumeAtSeconds: p.positionSeconds, bookmarked: p.isBookmarked })),
    attendance: attendances.map((a) => ({ class: a.session.title, at: iso(a.session.startsAt), status: a.status })),
    assessments: attempts.map((a) => ({ paper: a.assessment.title, attempt: a.attemptNo, status: a.status, startedAt: iso(a.startedAt), submittedAt: iso(a.submittedAt), scorePercent: a.scorePercent, passed: a.passed })),
    marking: submissions.map((s) => ({ paper: s.attempt.assessment.title, status: s.status, score: s.score, feedback: s.feedback, submittedAt: iso(s.submittedAt) })),
    assignments: assignments.map((a) => ({ assignment: a.assignment.title, attempt: a.attemptNo, status: a.status, handedInAt: iso(a.submittedAt), marks: a.marks, feedback: a.feedback, text: a.text })),
    notes: notes.map((n) => ({ lesson: n.material.title, atSeconds: n.atSeconds, body: n.body, at: iso(n.createdAt) })),
    questions: questions.map((q) => ({ lesson: q.material.title, question: q.body, askedAt: iso(q.createdAt), answer: q.answer, answeredAt: iso(q.answeredAt) })),
    certificates: certificates.map((c) => ({ certificate: c.template.name, serialNo: c.serialNo, issuedAt: iso(c.issuedAt), expiresAt: iso(c.expiresAt), revokedAt: iso(c.revokedAt), verifyPath: `/verify/${c.verifyToken}` })),
    reportCards: reportCards.map((r) => ({ title: r.title, course: r.enrollment.product.title, issuedAt: iso(r.issuedAt) })),
    reviews: testimonials.map((t) => ({ course: t.product?.title ?? null, rating: t.rating, comment: t.comment, published: t.isPublished, at: iso(t.createdAt) })),
    orders: orders.map((o) => ({
      orderNo: o.orderNo,
      invoiceNo: o.invoice?.invoiceNo ?? null,
      status: o.status,
      placedAt: iso(o.placedAt),
      items: o.items.map((i) => ({ item: i.product.title, price: money(i.pricePaise, o.currency) })),
      subtotal: money(o.subtotalPaise, o.currency),
      discount: money(o.discountPaise, o.currency),
      tax: money(o.taxPaise, o.currency),
      total: money(o.totalPaise, o.currency),
      billingAddress: o.billingAddress,
      payments: o.payments.map((p) => ({ gateway: p.gateway, method: p.method, amount: money(p.amountPaise, o.currency), status: p.status, at: iso(p.capturedAt) })),
    })),
    messagesSent: notifications.map((n) => ({ channel: n.channel, about: n.eventKey, to: n.target, status: n.status, at: iso(n.createdAt) })),
    signIns: sessions.map((s) => ({ from: s.ip, device: s.userAgent, at: iso(s.createdAt), until: iso(s.expiresAt) })),
    aiConversations: aiConversations.map((c) => ({ title: c.title, at: iso(c.createdAt) })),
    dataRequests: requests.map((r) => ({ kind: r.kind, status: r.status, reason: r.reason, note: r.note, at: iso(r.createdAt), handledAt: iso(r.handledAt) })),
  };
}

export type DataExport = NonNullable<Awaited<ReturnType<typeof buildDataExport>>>;
