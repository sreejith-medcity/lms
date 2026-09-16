import Link from 'next/link';
import { db } from '@/lib/db';
import { mockTestAllowance, telcConfig } from '@/lib/telc';
import { mockTestLine, mockTestsLeft } from '@/lib/mock-tests';
import { anthropicReady } from '@/lib/anthropic';
import { settingBool } from '@/lib/settings/store';
import { Badge, Card, Section } from '@/components/ui';

/**
 * Practice on the learner's home: the AI examiner for writing and
 * speaking, the partner mock exams with one button to get in, and the
 * results that came back, newest first. The mock test card is its own
 * piece so the practice room can show it too.
 */

/** The partner mock test: one button in, and how much of the allowance is left. */
export async function MockTestCard({
  organizationId,
  userId,
  unavailable = false,
}: {
  organizationId: string;
  userId: string;
  unavailable?: boolean;
}) {
  const allowance = await mockTestAllowance(organizationId, userId);
  const left = mockTestsLeft(allowance);
  const line = mockTestLine(allowance);
  const exhausted = left === 0;
  return (
    <Card className="flex flex-col">
      <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
        German
      </p>
      <p className="mt-1 text-base font-bold">TELC AI Mocktest</p>
      <p className="t-small muted mt-1.5 leading-relaxed">
        Full-length telc practice exams at A1 to B2, in the official format and timing, marked
        automatically with feedback on every module. You are signed in there with this account;
        no second password.
      </p>
      <div className="mt-auto pt-4">
        {exhausted ? (
          <span className="inline-flex h-10 cursor-not-allowed items-center rounded-[var(--radius-sm)] border px-4 text-sm font-semibold text-[var(--ink-2)]" aria-disabled>
            No mock tests left
          </span>
        ) : (
          <a
            href="/api/sso/telc/start"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Open the mock test
          </a>
        )}
        {line && <p className={`t-small mt-2 tabular-nums ${exhausted ? 'text-[var(--bad)]' : 'faint'}`}>{line}{exhausted ? '. Ask the office for more.' : ''}</p>}
        {unavailable && (
          <p className="t-small mt-2 text-[var(--bad)]">The mock test could not be opened just now. Try again in a minute.</p>
        )}
      </div>
    </Card>
  );
}

export async function PartnerPractice({
  organizationId,
  userId,
  unavailable = false,
}: {
  organizationId: string;
  userId: string;
  /** The learner just came back from a handoff that could not be made. */
  unavailable?: boolean;
}) {
  const [telc, examiner, results] = await Promise.all([
    telcConfig(organizationId),
    settingBool(organizationId, 'ai.practiceEnabled').then(async (on) => on && (await anthropicReady(organizationId))),
    db.partnerResult.findMany({
      where: { organizationId, userId },
      orderBy: { takenAt: 'desc' },
      take: 8,
      select: { id: true, provider: true, title: true, level: true, scorePercent: true, passed: true, takenAt: true, certificateUrl: true, detail: true },
    }),
  ]);

  if (!telc && !examiner && results.length === 0) return null;

  return (
    <Section title="Practice">
      <div className={`grid gap-4 ${telc && examiner ? 'lg:grid-cols-3' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'}`}>
        {examiner && (
          <Card className="flex flex-col">
            <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
              Writing and speaking
            </p>
            <p className="mt-1 text-base font-bold">AI examiner</p>
            <p className="t-small muted mt-1.5 leading-relaxed">
              IELTS, OET, PTE and German tasks in the exam&rsquo;s own style, marked to the official criteria
              within a minute, with your own sentences corrected. Speak or write, as many times as you like
              within the daily allowance.
            </p>
            <div className="mt-auto pt-4">
              <Link
                href="/learn/practice"
                className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                Practise now
              </Link>
            </div>
          </Card>
        )}
        {telc && <MockTestCard organizationId={organizationId} userId={userId} unavailable={unavailable} />}

        <Card padded={false}>
          <p className="border-b px-5 py-3 text-sm font-semibold">Your results</p>
          {results.length === 0 ? (
            <p className="t-small faint px-5 py-4">Nothing yet. Results appear here as soon as you finish a test.</p>
          ) : (
            <ul className="divide-y">
              {results.map((r) => {
                const modules = ((r.detail as { modules?: { name: string; score: number; max: number }[] } | null)?.modules ?? []).slice(0, 5);
                return (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="t-small faint">
                          {r.takenAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {r.level ? ` · ${r.level}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.scorePercent !== null && <span className="font-bold tabular-nums">{Math.round(r.scorePercent)}%</span>}
                        {r.passed === true && <Badge tone="ok">passed</Badge>}
                        {r.passed === false && <Badge tone="warn">not yet</Badge>}
                        {r.certificateUrl && (
                          <a href={r.certificateUrl} target="_blank" rel="noreferrer noopener" className="t-small underline">
                            Certificate
                          </a>
                        )}
                      </div>
                    </div>
                    {modules.length > 0 && (
                      <p className="t-small faint mt-1 tabular-nums">
                        {modules.map((m) => `${m.name} ${m.score}/${m.max}`).join(' · ')}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}
