'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addMyCard, deleteMyCard, gradeCard } from '@/server/flashcards';
import type { ActionState } from '@/server/courses';
import { Button, FormError, FormSuccess, Input, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface SessionCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  mine: boolean;
  fresh: boolean;
}

/**
 * One revision session: a card, a flip, four answers. The next card comes
 * up straight away and the grade is written in the background, so a
 * session on a train does not wait for the network between cards.
 */
export function ReviseSession({ cards, courseId }: { cards: SessionCard[]; courseId: string }) {
  const [queue, setQueue] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<{ again: number; ok: number }>({ again: 0, ok: 0 });
  const [note, setNote] = useState<string>();
  const [, start] = useTransition();
  const router = useRouter();

  const card = queue[index] ?? null;

  function grade(g: 0 | 1 | 2 | 3) {
    if (!card) return;
    const graded = card;
    setNote(undefined);
    setDone((d) => (g === 0 ? { ...d, again: d.again + 1 } : { ...d, ok: d.ok + 1 }));
    setFlipped(false);
    // A card forgotten comes round again at the end of this session.
    if (g === 0) setQueue((q) => [...q, { ...graded, fresh: false }]);
    setIndex((i) => i + 1);
    start(async () => {
      const r = await gradeCard(graded.id, g);
      if (r.error) setNote(r.error);
    });
  }

  if (!card) {
    return (
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6 text-center">
        <p className="t-heading">{queue.length === 0 ? 'Nothing to revise right now' : 'That is the session'}</p>
        <p className="t-small muted mt-1">
          {queue.length === 0
            ? 'Cards come up again when they are due. Come back tomorrow, or add a card of your own below.'
            : `${done.ok} remembered, ${done.again} to see again. The ones you knew come back later; the ones you did not, sooner.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => router.refresh()}>
            Check for more
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="t-small faint">
        {index + 1} of {queue.length}
        {card.fresh && ' · new card'}
        {card.mine && ' · your own card'}
      </p>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="block w-full rounded-[var(--radius-lg)] border bg-[var(--surface)] p-8 text-left shadow-sm"
        aria-label={flipped ? 'Showing the back' : 'Show the back'}
      >
        <p className="t-micro faint">{flipped ? 'Back' : 'Front'}</p>
        <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed">{flipped ? card.back : card.front}</p>
        {!flipped && card.hint && <p className="t-small faint mt-3">Hint: {card.hint}</p>}
        {!flipped && <p className="t-small muted mt-6">Tap to turn over</p>}
      </button>

      {flipped ? (
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              [0, 'Again', 'var(--bad)'],
              [1, 'Hard', 'var(--warn)'],
              [2, 'Good', 'var(--brand)'],
              [3, 'Easy', 'var(--ok)'],
            ] as const
          ).map(([g, label, colour]) => (
            <button
              key={g}
              type="button"
              onClick={() => grade(g)}
              className="h-11 rounded-[var(--radius-sm)] border text-sm font-semibold"
              style={{ borderColor: colour, color: colour }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <Button className="w-full justify-center" size="lg" onClick={() => setFlipped(true)}>
          Show the answer
        </Button>
      )}

      {card.mine && (
        <button
          type="button"
          className="t-small underline faint"
          onClick={() =>
            start(async () => {
              const r = await deleteMyCard(card.id);
              if (r.error) setNote(r.error);
              else {
                setQueue((q) => q.filter((c) => c.id !== card.id));
                setFlipped(false);
              }
            })
          }
        >
          Remove this card
        </button>
      )}
      {note && <FormError message={note} />}
      <input type="hidden" value={courseId} readOnly />
    </div>
  );
}

export function AddCardForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(addMyCard, initial);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add a card of your own
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-[var(--radius)] border bg-[var(--surface)] p-4">
      <input type="hidden" name="courseId" value={courseId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Input name="front" placeholder="Front: the word, or the question" maxLength={500} required />
      <Textarea name="back" rows={2} placeholder="Back: the answer" maxLength={2000} required />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="t-small faint">Only you see your own cards.</p>
    </form>
  );
}
