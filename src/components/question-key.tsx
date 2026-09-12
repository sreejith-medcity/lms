import type { AnswerKey } from '@/lib/question-scoring';

/** The key of a blank, match or ordering question, for staff eyes. */
export function QuestionKey({ answerKey }: { answerKey: AnswerKey | null }) {
  if (!answerKey) return null;
  if (answerKey.kind === 'FILL_BLANK') {
    return (
      <ol className="t-small muted mt-2 list-decimal space-y-0.5 pl-5">
        {answerKey.blanks.map((accepted, i) => (
          <li key={i}>{accepted.join(' or ')}</li>
        ))}
      </ol>
    );
  }
  if (answerKey.kind === 'MATCH') {
    return (
      <ul className="t-small muted mt-2 space-y-0.5">
        {answerKey.pairs.map((p, i) => (
          <li key={i}>
            {p.left} <span className="faint">→</span> {p.right}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ol className="t-small muted mt-2 list-decimal space-y-0.5 pl-5">
      {answerKey.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}
