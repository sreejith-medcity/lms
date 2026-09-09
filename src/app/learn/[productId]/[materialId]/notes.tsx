'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addNote, deleteNote, toggleBookmark, updateNote } from '@/server/notes';
import type { ActionState } from '@/server/courses';
import { Button, FormError, Textarea } from '@/components/ui';
import { stamp } from '@/components/media-player';

const initial: ActionState = {};

export interface NoteRow {
  id: string;
  body: string;
  atSeconds: number | null;
  createdAt: string;
}

/**
 * Notes taken while the lesson is open, pinned to the moment they were taken on
 * a recording. Clicking a timestamp seeks the player back to it, which is the
 * point: revision is finding the ninety seconds that mattered, not rewatching an
 * hour.
 */
export function Notes({
  materialId,
  notes,
  currentTime,
  onSeek,
}: {
  materialId: string;
  notes: NoteRow[];
  currentTime?: number | null;
  onSeek?: (seconds: number) => void;
}) {
  const [state, action, pending] = useActionState(addNote, initial);
  const router = useRouter();
  const [pinned, setPinned] = useState(true);

  if (state.ok) setTimeout(() => router.refresh(), 0);

  const at = pinned && currentTime != null ? Math.floor(currentTime) : null;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-2">
        <input type="hidden" name="materialId" value={materialId} />
        {at != null && <input type="hidden" name="atSeconds" value={at} />}
        <FormError message={state.error} />

        <Textarea
          name="body"
          rows={3}
          maxLength={4000}
          placeholder={
            currentTime != null
              ? `Note at ${stamp(at ?? 0)}. What is worth coming back to?`
              : 'What is worth coming back to?'
          }
          required
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving...' : 'Save note'}
          </Button>

          {currentTime != null && (
            <label className="t-small muted flex items-center gap-2">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Pin to {stamp(Math.floor(currentTime))}
            </label>
          )}
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="t-small faint">No notes on this lesson yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} onSeek={onSeek} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteItem({ note, onSeek }: { note: NoteRow; onSeek?: (seconds: number) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);

  return (
    <li className="rounded-[var(--radius-sm)] border bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        {note.atSeconds != null ? (
          <button
            type="button"
            onClick={() => onSeek?.(note.atSeconds ?? 0)}
            disabled={!onSeek}
            className="t-micro shrink-0 rounded-full px-2 py-0.5 font-medium tabular-nums disabled:cursor-default"
            style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
          >
            {stamp(note.atSeconds)}
          </button>
        ) : (
          <span className="t-micro faint shrink-0">
            {new Date(note.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        )}

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="t-micro faint hover:underline"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            type="button"
            disabled={pending}
            className="t-micro faint hover:underline"
            onClick={() =>
              start(async () => {
                await deleteNote(note.id);
                router.refresh();
              })
            }
          >
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await updateNote(note.id, body);
                setEditing(false);
                router.refresh();
              })
            }
          >
            Save
          </Button>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
      )}
    </li>
  );
}

export function BookmarkButton({ materialId, on }: { materialId: string; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [active, setActive] = useState(on);

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={active}
      title={active ? 'Remove the bookmark' : 'Bookmark this lesson'}
      onClick={() =>
        start(async () => {
          const res = await toggleBookmark(materialId);
          if (!res.error) {
            setActive(Boolean(res.on));
            router.refresh();
          }
        })
      }
      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm font-medium"
      style={active ? { color: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
    >
      <span aria-hidden>{active ? '★' : '☆'}</span>
      {active ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}
