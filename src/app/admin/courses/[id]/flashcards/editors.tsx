'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteCard, draftCardsFromLesson, saveCard } from '@/server/flashcards';
import type { ActionState } from '@/server/courses';
import { Badge, Button, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function CardEditor({ courseId, card, onDone }: { courseId: string; card?: { id: string; front: string; back: string; hint: string | null }; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveCard, initial);
  const router = useRouter();
  if (state.ok) {
    setTimeout(() => {
      router.refresh();
      onDone?.();
    }, 0);
  }
  return (
    <form action={action} className="space-y-2" key={state.ok && !card ? String(Date.now()) : 'form'}>
      <input type="hidden" name="courseId" value={courseId} />
      {card && <input type="hidden" name="id" value={card.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="front" placeholder="Front: the term or the question" defaultValue={card?.front ?? ''} maxLength={500} required />
        <Input name="hint" placeholder="Hint (optional)" defaultValue={card?.hint ?? ''} maxLength={200} />
      </div>
      <Textarea name="back" rows={2} placeholder="Back: the answer" defaultValue={card?.back ?? ''} maxLength={2000} required />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : card ? 'Save' : 'Add card'}
        </Button>
        {card && onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function CardRow({
  card,
  courseId,
  canEdit,
}: {
  card: { id: string; front: string; back: string; hint: string | null; source: string; reviewed: number };
  courseId: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string>();
  const router = useRouter();

  return (
    <li className="rounded-[var(--radius)] border bg-[var(--surface)] p-3">
      {editing ? (
        <CardEditor courseId={courseId} card={card} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{card.front}</p>
            <p className="t-small muted mt-0.5 whitespace-pre-wrap">{card.back}</p>
            {card.hint && <p className="t-small faint mt-0.5">Hint: {card.hint}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={card.source === 'AI' ? 'warn' : 'neutral'}>{card.source === 'AI' ? 'model' : 'trainer'}</Badge>
            <span className="t-small faint tabular-nums">{card.reviewed} seen</span>
            {canEdit && (
              <>
                <button type="button" className="t-small underline" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="t-small underline"
                  style={{ color: 'var(--bad)' }}
                  disabled={busy}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteCard(card.id);
                      setProblem(r.error);
                      if (!r.error) router.refresh();
                    })
                  }
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {problem && <FormError message={problem} />}
    </li>
  );
}

export function DraftFromLesson({ lessons }: { lessons: { id: string; title: string }[] }) {
  const [materialId, setMaterialId] = useState(lessons[0]?.id ?? '');
  const [count, setCount] = useState(15);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const router = useRouter();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)} aria-label="Lesson">
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </Select>
        </div>
        <Input type="number" min={1} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-20" aria-label="How many cards" />
        <Button
          variant="secondary"
          disabled={busy || !materialId}
          onClick={() =>
            start(async () => {
              setNote(undefined);
              setProblem(undefined);
              const r = await draftCardsFromLesson(materialId, count);
              if (r.error) setProblem(r.error);
              else {
                setNote(r.message);
                router.refresh();
              }
            })
          }
        >
          {busy ? 'Reading the lesson…' : 'Draft cards'}
        </Button>
      </div>
      {note && <FormSuccess message={note} />}
      {problem && <FormError message={problem} />}
    </div>
  );
}
