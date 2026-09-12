import { parseAnswerKey, normalise, uploadedAnswer, type AnswerKey } from '@/lib/question-scoring';

/**
 * What a learner answered, and what was wanted, for every kind of
 * question. Shared by the learner's review and the trainer's marking
 * screen so the two never disagree about how an answer is shown.
 *
 * `whose` is the word beside the learner's answer: "your" on the review,
 * "their" on the marking screen.
 */

export interface AnswerViewQuestion {
  type: string;
  response: unknown;
  options: { id: string; label: string; isCorrect: boolean }[];
  answerKey?: unknown;
}

const box = 'mt-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3';

export function QuestionMedia({ media }: { media: { url: string; kind: string } | null | undefined }) {
  if (!media) return null;
  if (media.kind === 'IMAGE') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.url} alt="" className="mt-3 max-h-96 w-auto max-w-full rounded-[var(--radius-sm)] border" />;
  }
  if (media.kind === 'AUDIO') return <audio controls preload="metadata" src={media.url} className="mt-3 w-full" />;
  if (media.kind === 'VIDEO') return <video controls preload="metadata" src={media.url} className="mt-3 max-h-96 w-full rounded-[var(--radius-sm)]" />;
  return null;
}

export function AnswerView({ q, showKey, whose = 'your' }: { q: AnswerViewQuestion; showKey: boolean; whose?: 'your' | 'their' }) {
  const key: AnswerKey | null = parseAnswerKey(q.type, q.answerKey);

  if (q.options.length > 0) {
    const chosen = Array.isArray(q.response) ? (q.response as unknown[]).map(String) : [];
    return (
      <ul className="mt-3 space-y-1.5">
        {q.options.map((o) => {
          const picked = chosen.includes(o.id);
          const right = showKey && o.isCorrect;
          return (
            <li
              key={o.id}
              className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-2.5 text-sm ${
                right ? 'border-[var(--ok)] bg-[var(--ok-soft)]' : picked && showKey ? 'border-[var(--bad)] bg-[var(--bad-soft)]' : picked ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : ''
              }`}
            >
              <span aria-hidden className="shrink-0">
                {right ? '✓' : picked && showKey ? '✕' : picked ? '•' : '·'}
              </span>
              <span>
                {o.label}
                {picked && <span className="t-micro faint ml-2">{whose} answer</span>}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (q.type === 'FILL_BLANK' && key?.kind === 'FILL_BLANK') {
    const given = Array.isArray(q.response) ? (q.response as unknown[]) : [];
    return (
      <ol className="mt-3 space-y-1.5">
        {key.blanks.map((accepted, i) => {
          const g = typeof given[i] === 'string' ? (given[i] as string) : '';
          const ok = showKey && g && accepted.some((a) => normalise(a, key.caseSensitive) === normalise(g, key.caseSensitive));
          return (
            <li key={i} className={`flex flex-wrap items-baseline gap-2 rounded-[var(--radius-sm)] border p-2.5 text-sm ${ok ? 'border-[var(--ok)] bg-[var(--ok-soft)]' : showKey && g ? 'border-[var(--bad)] bg-[var(--bad-soft)]' : ''}`}>
              <span className="t-micro faint tabular-nums">Blank {i + 1}</span>
              <span className="font-medium">{g || <span className="faint">left blank</span>}</span>
              {showKey && !ok && <span className="t-small faint">wanted: {accepted.join(' or ')}</span>}
            </li>
          );
        })}
      </ol>
    );
  }

  if (q.type === 'MATCH' && key?.kind === 'MATCH') {
    const given = Array.isArray(q.response) ? (q.response as unknown[]) : [];
    return (
      <ul className="mt-3 space-y-1.5">
        {key.pairs.map((p, i) => {
          const pick = typeof given[i] === 'number' && given[i] >= 0 ? key.pairs[given[i] as number]?.right : null;
          const ok = showKey && given[i] === i;
          return (
            <li key={i} className={`flex flex-wrap items-baseline gap-2 rounded-[var(--radius-sm)] border p-2.5 text-sm ${ok ? 'border-[var(--ok)] bg-[var(--ok-soft)]' : showKey && pick ? 'border-[var(--bad)] bg-[var(--bad-soft)]' : ''}`}>
              <span>{p.left}</span>
              <span className="faint">→</span>
              <span className="font-medium">{pick ?? <span className="faint">not matched</span>}</span>
              {showKey && !ok && <span className="t-small faint">wanted: {p.right}</span>}
            </li>
          );
        })}
      </ul>
    );
  }

  if (q.type === 'ORDERING' && key?.kind === 'ORDERING') {
    const given = Array.isArray(q.response) ? (q.response as unknown[]).map(Number) : [];
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className={box.replace('mt-3 ', '')}>
          <p className="t-micro faint uppercase tracking-wide">{whose === 'your' ? 'Your order' : 'Their order'}</p>
          {given.length ? (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm">
              {given.map((idx, i) => (
                <li key={i} className={showKey ? (idx === i ? 'text-[var(--ok)]' : 'text-[var(--bad)]') : ''}>
                  {key.items[idx] ?? '?'}
                </li>
              ))}
            </ol>
          ) : (
            <p className="t-small faint mt-1">Left as shown.</p>
          )}
        </div>
        {showKey && (
          <div className={box.replace('mt-3 ', '')}>
            <p className="t-micro faint uppercase tracking-wide">Right order</p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm">
              {key.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (q.type === 'FILE_UPLOAD' || q.type === 'SPEAKING') {
    const up = uploadedAnswer(q.response);
    if (!up) return <p className="t-small faint mt-3">Nothing was handed in.</p>;
    const url = `/api/assets/${up.assetId}`;
    return (
      <div className={box}>
        {q.type === 'SPEAKING' ? (
          <>
            <audio controls preload="metadata" src={url} className="w-full" />
            {up.durationSeconds ? <p className="t-small faint mt-1">{Math.round(up.durationSeconds)} seconds</p> : null}
          </>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="t-small font-medium hover:underline">
            {up.fileName}
          </a>
        )}
      </div>
    );
  }

  const written = typeof q.response === 'string' ? q.response : '';
  if (!written.trim()) return <p className="t-small faint mt-3">{whose === 'your' ? 'You left this blank.' : 'Left blank.'}</p>;
  return (
    <div className={box}>
      <p className="t-micro faint uppercase tracking-wide">{whose === 'your' ? 'Your answer' : 'Their answer'}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{written}</p>
    </div>
  );
}
