import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Badge, Card, Section } from '@/components/ui';
import { examFormat } from '@/lib/exams/registry';
import { criteriaFor } from '@/lib/exams/marking';
import { isAuto } from '@/lib/exams/types';
import { TEST_PERMS } from '@/lib/exams/perms';
import { MarkForm, RemarkButton, VoidButton } from '../../editors';

export const dynamic = 'force-dynamic';

type Feedback = { marks?: { criterion: string; points: number; comment: string }[]; overall?: string };
const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 100) / 100).replace('.', ','));

export default async function SittingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await requireStaff(TEST_PERMS.sittings, 'view');
  const s = await db.examSitting.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: { user: { select: { id: true, name: true, email: true, phone: true } }, submissions: true },
  });
  if (!s) notFound();
  const format = examFormat(s.formatCode);
  if (!format) notFound();
  const mayMark = can(user.permissions, TEST_PERMS.marking, 'edit');
  const mayVoid = can(user.permissions, TEST_PERMS.marking, 'delete');
  const allowance = s.allowanceId ? await db.examAllowance.findFirst({ where: { id: s.allowanceId, organizationId: tenant.organizationId }, select: { source: true, note: true } }) : null;
  const points = (s.points ?? {}) as Record<string, number | null>;
  const guard = (s.guard ?? {}) as Record<string, number>;
  const scope = s.sectionId ? [s.sectionId] : null;
  const tasks = format.blocks.filter((d) => !isAuto(d.layout) && (!scope || scope.includes(d.sectionId)));
  const when = (d: Date | null) => d?.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }) ?? '–';

  return (
    <div className="space-y-6">
      <p className="t-small">
        <Link href="/admin/tests/sittings" className="underline">
          Papers sat
        </Link>{' '}
        / {s.user.name}
      </p>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="t-heading">
              {s.user.name}: {format.name}
            </h2>
            <p className="t-small muted">
              {s.user.email ?? s.user.phone} · paper {s.drawCode} · {s.mode === 'practice' ? 'practice mode' : 'exam mode'}
              {s.sectionId ? ` · ${format.sections.find((x) => x.id === s.sectionId)?.title ?? s.sectionId} only` : ''}
            </p>
            <p className="t-small muted">
              Started {when(s.startedAt)} · handed in {when(s.submittedAt)}
              {s.minutes ? ` · ${s.minutes} min` : ''}
            </p>
            <p className="t-small muted">
              {s.assignmentId ? 'A set paper (no allowance used)' : allowance ? `From a ${allowance.source.toLowerCase()} allowance${allowance.note ? ` (${allowance.note})` : ''}` : 'No allowance (staff)'}
            </p>
            {(guard.leave || guard.copy || guard.translate) && (
              <p className="t-small text-[var(--warn)]">
                Left the window {guard.leave ?? 0}× · copy attempts {guard.copy ?? 0} · translation {guard.translate ?? 0}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {fmt(s.total)} <span className="t-small faint">/ {fmt(s.maxPoints)}</span>
            </p>
            {s.passed != null && <Badge tone={s.passed ? 'ok' : 'bad'}>{s.passed ? 'pass' : 'not yet'}</Badge>}
            <p className="mt-2">
              <Link className="t-small underline" href={`/exam/${s.id}/result`}>
                The result as the learner sees it
              </Link>
            </p>
          </div>
        </div>
        <ul className="t-small mt-4 grid gap-1 sm:grid-cols-2">
          {format.scoring.modules
            .filter((m) => format.blocks.some((b) => b.moduleId === m.id && (!scope || scope.includes(b.sectionId))))
            .map((m) => (
              <li key={m.id} className="flex justify-between gap-3 border-b py-1">
                <span>{m.name}</span>
                <span className="tabular-nums">
                  {points[m.id] == null ? 'open' : fmt(points[m.id])} / {m.max}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      {tasks.length > 0 && (
        <Section title="Writing and speaking" action={mayMark && s.status !== 'IN_PROGRESS' && s.status !== 'VOID' ? <RemarkButton sittingId={s.id} /> : undefined}>
          {tasks.map((d) => {
            const sub = s.submissions.find((x) => x.task === d.id);
            const fb = (sub?.aiFeedback ?? null) as Feedback | null;
            const max = criteriaFor(format, d).reduce((a, c) => a + c.max, 0);
            return (
              <Card key={d.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">
                    {d.part}: {d.title}
                  </h3>
                  <span className="t-small tabular-nums">
                    model {fmt(sub?.aiPoints)} · tutor {fmt(sub?.tutorPoints)} · of {fmt(max)}
                  </span>
                </div>
                {!sub && <p className="t-small muted mt-2">Not attempted; it counts as nought.</p>}
                {sub?.kind === 'WRITING' && (
                  <div className="mt-3 whitespace-pre-wrap rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3 text-sm">
                    {sub.text || <span className="faint">(empty)</span>}
                    <p className="t-small faint mt-2">{sub.words ?? 0} words</p>
                  </div>
                )}
                {sub?.kind === 'SPEAKING' && sub.recordingAssetId && (
                  <div className="mt-3 space-y-2">
                    <audio controls preload="none" src={`/api/tests/${s.id}/recording/${d.id}`} className="w-full" />
                    <p className="t-small faint">{sub.seconds ?? 0} seconds</p>
                    {sub.text && (
                      <details>
                        <summary className="t-small">Transcript (by the model)</summary>
                        <p className="t-small mt-1 whitespace-pre-wrap">{sub.text}</p>
                      </details>
                    )}
                  </div>
                )}
                {fb?.marks && (
                  <ul className="t-small mt-3 space-y-1">
                    {fb.marks.map((m) => (
                      <li key={m.criterion}>
                        <b>{m.criterion}</b> {fmt(m.points)}: {m.comment}
                      </li>
                    ))}
                    {fb.overall && <li className="muted">{fb.overall}</li>}
                  </ul>
                )}
                {sub?.aiError && sub.aiPoints == null && <p className="t-small mt-2 text-[var(--warn)]">The model failed: {sub.aiError}</p>}
                {sub && mayMark && s.status !== 'VOID' && <MarkForm submissionId={sub.id} max={max} current={sub.tutorPoints} note={sub.tutorNote} />}
              </Card>
            );
          })}
        </Section>
      )}

      {mayVoid && s.status !== 'VOID' && (
        <div>
          <VoidButton sittingId={s.id} spent={Boolean(s.allowanceId)} />
        </div>
      )}
    </div>
  );
}
