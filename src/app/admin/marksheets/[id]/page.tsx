import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { canSeeBatch, staffScope } from '@/lib/scope';
import { parseBands } from '@/lib/grading';
import { computeEntry, diffVersions, reviewSheet, type SheetRules } from '@/lib/mark-sheets';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { Badge } from '@/components/ui';
import { SheetEditor } from './editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const LABEL = { DRAFT: 'draft', SUBMITTED: 'with the Branch Head', RETURNED: 'returned', PUBLISHED: 'published' } as const;
const TONE = { DRAFT: 'neutral', SUBMITTED: 'warn', RETURNED: 'bad', PUBLISHED: 'ok' } as const;

/**
 * One sheet: the teacher's entry grid while it is a draft, the Branch
 * Head's review while it is submitted, the record once it is published.
 * The same page for all three, because the marks are the same marks and a
 * second layout is a second place for them to disagree.
 */
export default async function MarkSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const scope = await staffScope(me);
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;
  const tz = tenant.timezone;

  const sheet = await db.markSheet.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      title: true,
      category: true,
      skill: true,
      level: true,
      status: true,
      testDate: true,
      maxMarks: true,
      passPercent: true,
      assetIds: true,
      version: true,
      supersedesId: true,
      supersededById: true,
      correctionReason: true,
      returnReason: true,
      submittedAt: true,
      submittedById: true,
      decidedAt: true,
      decidedById: true,
      publishedAt: true,
      createdById: true,
      assessmentId: true,
      batch: {
        select: {
          id: true,
          name: true,
          branchId: true,
          branch: { select: { name: true, headUserId: true, deputyUserId: true } },
          course: { select: { product: { select: { title: true } }, program: { select: { gradeScaleId: true, passPercent: true } } } },
          enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] } }, orderBy: { user: { name: 'asc' } }, select: { user: { select: { id: true, name: true } } } },
        },
      },
      entries: { select: { userId: true, outcome: true, marks: true, grade: true, passed: true, remark: true, override: true } },
      corrected: { select: { id: true, status: true, version: true } },
    },
  });
  if (!sheet || !canSeeBatch(scope, sheet.batch)) notFound();

  const program = sheet.batch.course.program;
  const scale = program?.gradeScaleId
    ? await db.gradeScale.findFirst({ where: { id: program.gradeScaleId, organizationId: tenant.organizationId }, select: { bands: true } })
    : await db.gradeScale.findFirst({ where: { organizationId: tenant.organizationId, isActive: true }, select: { bands: true } });
  const rules: SheetRules = { maxMarks: sheet.maxMarks, passPercent: sheet.passPercent ?? program?.passPercent ?? null, bands: scale ? parseBands(scale.bands) : [] };

  const roster = sheet.batch.enrollments.map((e) => ({ userId: e.user.id, name: e.user.name }));
  const entries = sheet.entries.map((e) => ({ userId: e.userId, outcome: e.outcome, marks: e.marks, remark: e.remark, override: e.override }));
  const review = reviewSheet(roster, entries, rules);
  const computed = entries.map((e) => computeEntry(e, rules));

  // The version this corrects, for the diff on the approval screen.
  const previous = sheet.supersedesId
    ? await db.markSheet.findFirst({ where: { id: sheet.supersedesId, organizationId: tenant.organizationId }, select: { entries: { select: { userId: true, outcome: true, marks: true, remark: true, override: true } } } })
    : null;
  const diff = previous ? diffVersions(roster, previous.entries.map((e) => computeEntry(e, rules)), computed) : [];

  const peopleIds = [sheet.createdById, sheet.submittedById, sheet.decidedById, sheet.batch.branch.headUserId, sheet.batch.branch.deputyUserId].filter((x): x is string => Boolean(x));
  const people = peopleIds.length ? new Map((await db.user.findMany({ where: { id: { in: peopleIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();
  const files = sheet.assetIds.length ? await db.asset.findMany({ where: { id: { in: sheet.assetIds }, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true, fileName: true } }) : [];

  const isApprover = scope.kind !== 'batches';
  const stamp = (d: Date | null) => (d ? `${formatDayLabel(dayKey(d, tz), tz)} ${formatTime(d, tz)}` : '');

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href={isApprover && sheet.status === 'SUBMITTED' ? '/admin/approvals' : '/admin/marksheets'} className="t-small faint hover:underline">
          {isApprover && sheet.status === 'SUBMITTED' ? 'Approvals' : 'Mark sheets'}
        </Link>
        <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
          {sheet.title}
          <Badge tone={TONE[sheet.status]}>{LABEL[sheet.status]}</Badge>
          {sheet.version > 1 && <Badge tone="neutral">version {sheet.version}</Badge>}
          {sheet.supersededById && <Badge tone="warn">replaced by a correction</Badge>}
        </h1>
        <p className="t-small faint mt-1">
          {sheet.batch.name} · {sheet.batch.course.product.title}
          {sheet.level ? ` · ${sheet.level}` : ''} · {sheet.category}
          {sheet.skill ? ` · ${sheet.skill}` : ''} · {formatDayLabel(dayKey(sheet.testDate, tz), tz)} · out of {sheet.maxMarks}
          {rules.passPercent !== null ? ` · pass at ${rules.passPercent}%` : ''}
        </p>
        <p className="t-small faint mt-1">
          Branch: {sheet.batch.branch.name}
          {sheet.batch.branch.headUserId ? ` · approved by ${people.get(sheet.batch.branch.headUserId) ?? 'the Branch Head'}` : ' · no Branch Head named yet'}
          {sheet.batch.branch.deputyUserId ? ` (deputy ${people.get(sheet.batch.branch.deputyUserId)})` : ''}
        </p>
        {sheet.correctionReason && <p className="t-small mt-1">Correction: {sheet.correctionReason}</p>}
        {sheet.status === 'RETURNED' && sheet.returnReason && (
          <p className="t-small mt-1 text-[var(--bad)]">
            Returned{sheet.decidedById ? ` by ${people.get(sheet.decidedById)}` : ''} {stamp(sheet.decidedAt)}: {sheet.returnReason}
          </p>
        )}
        {sheet.status === 'SUBMITTED' && (
          <p className="t-small mt-1">
            Submitted{sheet.submittedById ? ` by ${people.get(sheet.submittedById)}` : ''} {stamp(sheet.submittedAt)}.
          </p>
        )}
        {sheet.status === 'PUBLISHED' && (
          <p className="t-small mt-1 text-[var(--ok)]">
            Published{sheet.decidedById ? ` by ${people.get(sheet.decidedById)}` : ''} {stamp(sheet.publishedAt)}.
          </p>
        )}
      </div>

      <SheetEditor
        sheetId={sheet.id}
        status={sheet.status}
        superseded={Boolean(sheet.supersededById)}
        correctionInProgress={sheet.corrected && sheet.corrected.status !== 'PUBLISHED' ? { id: sheet.corrected.id, version: sheet.corrected.version } : null}
        canEdit={canEdit}
        isApprover={isApprover}
        submittedByMe={sheet.submittedById === me.id}
        maxMarks={sheet.maxMarks}
        roster={roster}
        entries={computed.map((c) => ({ userId: c.userId, outcome: c.outcome, marks: c.marks, remark: c.remark ?? '', override: c.override ?? '', grade: c.grade, passed: c.passed, percent: c.percent }))}
        review={review}
        diff={diff}
        files={files}
      />
    </div>
  );
}
