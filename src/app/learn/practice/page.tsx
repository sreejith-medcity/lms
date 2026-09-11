import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { anthropicReady } from '@/lib/anthropic';
import { practiceAllowance } from '@/lib/ai-practice';
import { settingBool } from '@/lib/settings/store';
import { EXAM_PRESETS, presetFor } from '@/lib/ai-evaluation';
import { Badge, Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practice' };

const when = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * The practice room: every exam the examiner marks, and what the learner
 * has done so far. When the key is not in place the page says so in
 * plain words instead of offering buttons that fail.
 */
export default async function PracticePage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const [enabled, ready] = await Promise.all([
    settingBool(tenant.organizationId, 'ai.practiceEnabled'),
    anthropicReady(tenant.organizationId),
  ]);

  const [allowance, attempts] = await Promise.all([
    practiceAllowance(tenant.organizationId, user.id),
    db.practiceAttempt.findMany({
      where: { organizationId: tenant.organizationId, userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, exam: true, kind: true, scoreLabel: true, score: true, evaluation: true, createdAt: true, durationSeconds: true },
    }),
  ]);

  const writing = EXAM_PRESETS.filter((p) => p.kind === 'WRITING');
  const speaking = EXAM_PRESETS.filter((p) => p.kind === 'SPEAKING');
  const left = Math.max(0, allowance.limit - allowance.used);

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Practice</h1>
          <p className="t-small faint mt-1 max-w-2xl">
            Writing and speaking tasks in the style of your exam, marked to the official criteria within a
            minute, with corrections in your own words. It is practice, not a prediction: a real examiner on
            the day may see it differently.
          </p>
        </div>
        {enabled && ready && (
          <p className="t-small tabular-nums">
            <span className="font-semibold">{left}</span>
            <span className="faint"> of {allowance.limit} attempts left today</span>
          </p>
        )}
      </div>

      {!enabled ? (
        <div className="mt-6">
          <EmptyState title="Practice is switched off" hint="The academy has turned the AI examiner off for now." />
        </div>
      ) : !ready ? (
        <Card className="mt-6 border-dashed">
          <p className="font-semibold">The examiner is not connected yet</p>
          <p className="t-small muted mt-1 leading-relaxed">
            Practice runs on Claude, and the academy has not added its Anthropic key under Integrations yet. Once it is
            in, this page works immediately; nothing else needs setting up.
          </p>
        </Card>
      ) : (
        <>
          <ExamGrid title="Writing" presets={writing} />
          <ExamGrid title="Speaking" presets={speaking} note="Speak into your microphone; the browser transcribes and the examiner marks the transcript." />
        </>
      )}

      <section className="mt-10">
        <h2 className="text-base font-semibold">Your attempts</h2>
        {attempts.length === 0 ? (
          <p className="t-small faint mt-2">Nothing yet. Your reports collect here so you can see the marks move.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-[var(--radius)] border">
            <ul className="divide-y">
              {attempts.map((a) => {
                const preset = presetFor(a.exam);
                const ev = (a.evaluation ?? {}) as { pass?: boolean; summary?: string };
                return (
                  <li key={a.id}>
                    <Link href={`/learn/practice/attempts/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-[var(--surface-2)]">
                      <span className="t-small faint w-16 shrink-0 tabular-nums">{when(a.createdAt)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{preset?.label ?? a.exam}</span>
                        {ev.summary && <span className="t-small faint line-clamp-1">{ev.summary}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {a.scoreLabel && <span className="text-sm font-semibold tabular-nums">{a.scoreLabel}</span>}
                        {ev.pass === true && <Badge tone="ok">pass</Badge>}
                        {ev.pass === false && <Badge tone="warn">below</Badge>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function ExamGrid({ title, presets, note }: { title: string; presets: typeof EXAM_PRESETS; note?: string }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="t-small faint mt-0.5">{note}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => (
          <Link key={p.key} href={`/learn/practice/${p.key}`} className="group block h-full">
            <Card className="flex h-full flex-col transition group-hover:border-[var(--brand)]">
              <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
                {p.language === 'de' ? 'German' : 'English'}
              </p>
              <p className="mt-1 font-semibold">{p.label}</p>
              <p className="t-small muted mt-1.5 flex-1 leading-relaxed">{p.blurb}</p>
              <p className="t-small faint mt-3">
                Marked on {p.scale.name === 'Band' ? 'bands 0 to 9' : `${p.scale.min} to ${p.scale.max} ${p.scale.name === 'Punkte' ? 'Punkte' : ''}`.trim()} · pass at {p.pass}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
