'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCaptions, pullCaptionsNow, removeTranscript, uploadCaptions } from '@/server/transcripts';
import type { ActionState } from '@/server/courses';
import { Button, FormError } from '@/components/ui';

const initial: ActionState = {};

export interface CaptionState {
  /** Words in the transcript, or null when there is none. */
  words: number | null;
  language: string | null;
  source: string | null;
  /** The platform has been asked and has not answered yet. */
  requested: boolean;
  /** The platform can write them: encode ready and the provider supports it. */
  canGenerate: boolean;
}

/**
 * Captions on one file: what it has, and the three ways to get some. Small
 * on purpose; it sits inside a library card.
 */
export function CaptionsPanel({ assetId, state }: { assetId: string; state: CaptionState }) {
  const [open, setOpen] = useState(false);
  const [upload, uploadAction, uploading] = useActionState(uploadCaptions, initial);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const router = useRouter();

  if (upload.ok) setTimeout(() => router.refresh(), 0);

  function run(fn: () => Promise<ActionState>) {
    setNote(undefined);
    setProblem(undefined);
    start(async () => {
      const r = await fn();
      if (r.error) setProblem(r.error);
      else {
        setNote(r.message);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-small">
          {state.words !== null ? (
            <>
              Captions: <strong>{state.words.toLocaleString('en-IN')} words</strong>
              <span className="faint">
                {' '}
                · {state.language ?? 'en'} · {state.source === 'PROVIDER' ? 'written by the platform' : state.source === 'AI' ? 'written by the tutor' : 'uploaded'}
              </span>
            </>
          ) : state.requested ? (
            <span className="faint">Captions being written by the platform…</span>
          ) : (
            <span className="faint">No captions yet</span>
          )}
        </span>
        <button type="button" className="t-small ml-auto underline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : state.words !== null ? 'Change' : 'Add'}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <form action={uploadAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="assetId" value={assetId} />
            <input type="file" name="file" accept=".vtt,.srt,text/vtt" className="t-small max-w-[12rem]" required />
            <input name="language" defaultValue={state.language ?? 'en'} maxLength={10} className="t-small h-8 w-14 rounded border px-2" aria-label="Language code" />
            <Button size="sm" type="submit" disabled={uploading}>
              {uploading ? 'Saving…' : 'Upload .vtt or .srt'}
            </Button>
          </form>
          <FormError message={upload.error} />
          <div className="flex flex-wrap gap-2">
            {state.canGenerate && !state.requested && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => generateCaptions(assetId))}>
                Write them from the audio
              </Button>
            )}
            {state.requested && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => pullCaptionsNow(assetId))}>
                Pull them in
              </Button>
            )}
            {state.words !== null && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => removeTranscript(assetId))}>
                Remove
              </Button>
            )}
          </div>
          {note && <p className="t-small" style={{ color: 'var(--ok)' }}>{note}</p>}
          {problem && <FormError message={problem} />}
        </div>
      )}
    </div>
  );
}
