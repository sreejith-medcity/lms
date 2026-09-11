import type { Evaluation } from '@/lib/ai-evaluation';
import { Badge } from '@/components/ui';

/**
 * The examiner's report, the same on the learner's practice page and on
 * the trainer's marking screen: the mark first, then each criterion with
 * a bar and a sentence, then what to keep doing, what to change, and the
 * learner's own phrases corrected. Reads as a page of feedback, not a
 * dump of a JSON object.
 */
export function EvaluationReport({
  evaluation,
  scale,
  scoreLabel,
  pass,
  compact = false,
}: {
  evaluation: Evaluation;
  scale: { min: number; max: number; name: string };
  scoreLabel: string;
  pass?: boolean | null;
  compact?: boolean;
}) {
  const range = Math.max(1, scale.max - scale.min);
  const pct = (n: number) => Math.round(((n - scale.min) / range) * 100);

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className={compact ? 'text-2xl font-bold tabular-nums' : 'text-4xl font-bold tabular-nums'}>{scoreLabel}</p>
        {pass === true && <Badge tone="ok">at the pass line</Badge>}
        {pass === false && <Badge tone="warn">below the pass line</Badge>}
      </div>

      {evaluation.summary && <p className={`leading-relaxed ${compact ? 'text-sm' : 'text-base'}`}>{evaluation.summary}</p>}

      <div>
        <p className="t-eyebrow faint">By criterion</p>
        <ul className="mt-2 space-y-3">
          {evaluation.criteria.map((c) => (
            <li key={c.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{c.name}</span>
                <span className="t-small tabular-nums">{c.score}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full" style={{ width: `${pct(c.score)}%`, background: 'var(--brand)' }} />
              </div>
              {c.comment && <p className="t-small muted mt-1 leading-relaxed">{c.comment}</p>}
            </li>
          ))}
        </ul>
      </div>

      {(evaluation.strengths.length > 0 || evaluation.improvements.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {evaluation.strengths.length > 0 && (
            <div>
              <p className="t-eyebrow" style={{ color: 'var(--ok)' }}>
                Keep doing
              </p>
              <ul className="mt-2 space-y-1.5">
                {evaluation.strengths.map((s, i) => (
                  <li key={i} className="t-small flex gap-2 leading-relaxed">
                    <span aria-hidden style={{ color: 'var(--ok)' }}>
                      ✓
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evaluation.improvements.length > 0 && (
            <div>
              <p className="t-eyebrow" style={{ color: 'var(--warn)' }}>
                Work on
              </p>
              <ul className="mt-2 space-y-1.5">
                {evaluation.improvements.map((s, i) => (
                  <li key={i} className="t-small flex gap-2 leading-relaxed">
                    <span aria-hidden style={{ color: 'var(--warn)' }}>
                      →
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {evaluation.corrections.length > 0 && (
        <div>
          <p className="t-eyebrow faint">Your words, corrected</p>
          <div className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] border">
            <table className="w-full text-sm">
              <tbody>
                {evaluation.corrections.map((c, i) => (
                  <tr key={i} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2 text-[var(--bad)] line-through decoration-[var(--bad)]/60">{c.original}</td>
                    <td className="px-3 py-2 font-medium">{c.better}</td>
                    <td className="t-small faint px-3 py-2">{c.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** The stored JSON back into the report's shape, tolerant of an older row. */
export function evaluationFromJson(value: unknown): Evaluation | null {
  const v = (value ?? null) as Partial<Evaluation> | null;
  if (!v || typeof v !== 'object' || typeof v.overall !== 'number') return null;
  return {
    overall: v.overall,
    criteria: Array.isArray(v.criteria) ? v.criteria : [],
    strengths: Array.isArray(v.strengths) ? v.strengths : [],
    improvements: Array.isArray(v.improvements) ? v.improvements : [],
    corrections: Array.isArray(v.corrections) ? v.corrections : [],
    summary: typeof v.summary === 'string' ? v.summary : '',
  };
}
