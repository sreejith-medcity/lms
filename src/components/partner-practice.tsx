import { db } from '@/lib/db';
import { telcConfig } from '@/lib/telc';
import { Badge, Card, Section } from '@/components/ui';

/**
 * The partner practice exams on the learner's home: one button to get in,
 * and the results that came back, newest first.
 */
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
  const [telc, results] = await Promise.all([
    telcConfig(organizationId),
    db.partnerResult.findMany({
      where: { organizationId, userId },
      orderBy: { takenAt: 'desc' },
      take: 8,
      select: { id: true, provider: true, title: true, level: true, scorePercent: true, passed: true, takenAt: true, certificateUrl: true, detail: true },
    }),
  ]);

  if (!telc && results.length === 0) return null;

  return (
    <Section title="Practice exams">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {telc && (
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
              <a
                href="/api/sso/telc/start"
                className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                Open the mock test
              </a>
              {unavailable && (
                <p className="t-small mt-2 text-[var(--bad)]">The mock test could not be opened just now. Try again in a minute.</p>
              )}
            </div>
          </Card>
        )}

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
