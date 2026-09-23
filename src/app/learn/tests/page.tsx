import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState } from '@/components/ui';
import { EXAM_FORMATS, FAMILY_NAMES } from '@/lib/exams/registry';
import { setCounts } from '@/lib/exams/content';
import { syncCourseAllowances } from '@/lib/exams/course-allowances';
import { leftAt, standing, standingLine, type AllowanceRow } from '@/lib/exams/allowance';
import { StartButtons } from './start-buttons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tests' };

const fmt = (n: number | null) => (n == null ? '–' : String(Math.round(n * 100) / 100).replace('.', ','));

/**
 * The learner's tests: every mock exam the academy offers, how many papers
 * their courses and packs leave them at each level, the papers a tutor has
 * set their batch, a paper under way to carry on with, and every result.
 */
export default async function LearnerTests() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  await syncCourseAllowances(tenant.organizationId, user.id);

  const [counts, allowances, sittings, enrolments] = await Promise.all([
    setCounts(tenant.organizationId),
    db.examAllowance.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, revokedAt: null } }),
    db.examSitting.findMany({
      where: { organizationId: tenant.organizationId, userId: user.id, status: { not: 'VOID' } },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: { id: true, formatCode: true, status: true, startedAt: true, total: true, maxPoints: true, passed: true, mode: true, sectionId: true },
    }),
    db.enrollment.findMany({ where: { organizationId: tenant.organizationId, userId: user.id, status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } }, select: { batchId: true } }),
  ]);
  const batchIds = enrolments.map((e) => e.batchId).filter((x): x is string => Boolean(x));
  const assignments = batchIds.length
    ? await db.examAssignment.findMany({ where: { organizationId: tenant.organizationId, active: true, batchId: { in: batchIds } }, orderBy: { createdAt: 'desc' }, take: 20 })
    : [];

  const now = new Date();
  const rows = allowances as AllowanceRow[];
  const offered = EXAM_FORMATS.filter((f) => (counts[f.code] ?? 0) > 0);
  const families = [...new Set(offered.map((f) => f.family))];
  const open = sittings.filter((s) => s.status === 'IN_PROGRESS');
  const done = sittings.filter((s) => s.status !== 'IN_PROGRESS');
  const nameOf = (code: string) => EXAM_FORMATS.find((f) => f.code === code)?.name ?? code;

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <h1 className="text-xl font-semibold">Tests</h1>
      <p className="t-small faint mt-1 max-w-2xl">
        Full mock exams in the format of the real ones: the same parts, the same clocks, the same marking. Reading and listening are counted the moment you hand in;
        writing and speaking are marked to the exam&rsquo;s criteria within minutes, and your tutor can look again. Practice papers, not a certificate.
      </p>

      {open.length > 0 && (
        <Card className="mt-6">
          <p className="font-medium">Carry on where you stopped</p>
          <ul className="mt-2 space-y-2">
            {open.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {nameOf(s.formatCode)} <span className="t-small faint">started {s.startedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone })}</span>
                </span>
                <Link className="underline" href={`/exam/${s.id}`}>
                  Open the paper
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {assignments.length > 0 && (
        <Card className="mt-6">
          <p className="font-medium">Set by your tutor</p>
          <ul className="mt-3 space-y-3">
            {assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p>{a.title || nameOf(a.formatCode)}</p>
                  <p className="t-small faint">
                    {nameOf(a.formatCode)}
                    {a.dueAt ? ` · by ${a.dueAt.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: tenant.timezone })}` : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </p>
                </div>
                <StartButtons formatCode={a.formatCode} assignmentId={a.id} practice={false} label="Start" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {offered.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No tests yet" hint="Your academy has not put any mock exams up yet." />
        </div>
      ) : (
        families.map((family) => {
          const list = offered.filter((f) => f.family === family);
          const s = standing(rows, family, now);
          return (
            <section key={family} className="mt-8">
              <h2 className="text-lg font-semibold">{FAMILY_NAMES[family] ?? family}</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {list.map((f) => {
                  const papers = leftAt(rows, f.family, f.level, now);
                  const mine = s.find((x) => x.level === f.level) ?? s.find((x) => x.level === null);
                  return (
                    <Card key={f.code}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{f.name}</p>
                          <p className="t-small faint">{f.subtitle}</p>
                        </div>
                        {papers > 0 ? <Badge tone="ok">{papers === Infinity ? 'unlimited' : `${papers} left`}</Badge> : <Badge tone="neutral">none left</Badge>}
                      </div>
                      <p className="t-small muted mt-2">{f.timeLine}</p>
                      {mine && <p className="t-small faint mt-1">Your papers: {standingLine(mine)}</p>}
                      <div className="mt-4">
                        {papers > 0 ? (
                          <StartButtons formatCode={f.code} practice label="Start the exam" />
                        ) : (
                          <Link href={`/tests/${f.slug}`} className="t-small underline">
                            Get more papers
                          </Link>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your results</h2>
        {done.length === 0 ? (
          <p className="t-small faint mt-2">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)] rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)]">
            {done.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p>
                    {nameOf(s.formatCode)}
                    {s.mode === 'practice' ? <span className="t-small faint"> · practice</span> : null}
                  </p>
                  <p className="t-small faint">{s.startedAt.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: tenant.timezone })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {fmt(s.total)} / {fmt(s.maxPoints)}
                  </span>
                  {s.status === 'SUBMITTED' ? <Badge tone="warn">being marked</Badge> : s.passed == null ? null : s.passed ? <Badge tone="ok">passed</Badge> : <Badge tone="neutral">not passed</Badge>}
                  <Link className="underline" href={`/exam/${s.id}/result`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
