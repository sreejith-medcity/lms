'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { attachToNotice, correctNotice, discardNoticeDraft, publishNotice, setCorrectionNote, withdrawNotice } from '@/server/notices';
import { Button, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { Uploader } from '@/components/uploader';

/**
 * What can happen to a notice from its page. Publish shows the count it
 * will reach and asks once; withdraw needs a reason; correct opens a new
 * version. Every button is a server action with the same checks the page
 * ran, so a stale tab cannot publish twice.
 */
export function NoticeControls({
  id,
  status,
  superseded,
  countLine,
  files,
  correctionNote,
  isCorrection,
}: {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  superseded: boolean;
  countLine: string;
  files: { id: string; name: string }[];
  correctionNote: string;
  isCorrection: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | 'discard' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(correctionNote);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      setError(undefined);
      setMessage(undefined);
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        setMessage(res?.message);
        setConfirm(null);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <FormSuccess message={message} />

      {status === 'DRAFT' && (
        <div className="rounded-[var(--radius-sm)] border p-4">
          <p className="t-small font-medium">Files</p>
          {files.length === 0 ? <p className="t-small faint mt-1">None attached.</p> : (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <a href={`/api/assets/${f.id}`} target="_blank" rel="noreferrer" className="truncate underline">{f.name}</a>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => attachToNotice(id, f.id, false))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          {files.length < 5 && (
            <div className="mt-3">
              <Uploader label="Attach a file" hint="A circular, a timetable, a form. PDF or image, up to five." onUploaded={(a) => run(() => attachToNotice(id, a.id, true))} />
            </div>
          )}
        </div>
      )}

      {status === 'DRAFT' && isCorrection && (
        <div className="rounded-[var(--radius-sm)] border p-4">
          <p className="t-small font-medium">What changed</p>
          <p className="t-small faint mt-0.5">Shown to parents above the corrected notice, so the change is visible rather than guessed at.</p>
          <div className="mt-2 flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="The meeting moves from Saturday to Sunday, same time." />
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setCorrectionNote(id, note))}>Save</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status === 'DRAFT' && (
          <>
            <a href={`/admin/notices/${id}/edit`} className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm hover:bg-[var(--surface-2)]">Edit</a>
            <Button disabled={pending} onClick={() => setConfirm('publish')}>Publish</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm('discard')}>Discard draft</Button>
          </>
        )}
        {status === 'PUBLISHED' && !superseded && (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => run(() => correctNotice(id))}>Send a correction</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm('withdraw')}>Withdraw</Button>
          </>
        )}
      </div>

      {confirm === 'publish' && (
        <div className="rounded-[var(--radius-sm)] border p-4" style={{ background: 'var(--surface-2)' }}>
          <p className="text-sm font-medium">Publish now?</p>
          <p className="t-small mt-1">{countLine}</p>
          <p className="t-small faint mt-1">Each parent gets one inbox entry, a push where they allowed it, and the channels set for notices. It cannot be unsent; it can be withdrawn or corrected.</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={pending} onClick={() => run(() => publishNotice(id))}>{pending ? 'Publishing...' : 'Yes, publish'}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Not yet</Button>
          </div>
        </div>
      )}

      {confirm === 'withdraw' && (
        <div className="rounded-[var(--radius-sm)] border p-4" style={{ background: 'var(--surface-2)' }}>
          <p className="text-sm font-medium">Withdraw this notice?</p>
          <p className="t-small faint mt-1">It stays on record here. In the parent's inbox it is marked withdrawn with your reason; nothing is deleted from their phone.</p>
          <Textarea className="mt-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is withdrawn, in one line" />
          <div className="mt-3 flex gap-2">
            <Button disabled={pending || reason.trim().length < 3} onClick={() => run(() => withdrawNotice(id, reason))}>Withdraw</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Keep it</Button>
          </div>
        </div>
      )}

      {confirm === 'discard' && (
        <div className="rounded-[var(--radius-sm)] border p-4" style={{ background: 'var(--surface-2)' }}>
          <p className="text-sm font-medium">Discard this draft?</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={pending} onClick={() => run(() => discardNoticeDraft(id))}>Discard</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>Keep it</Button>
          </div>
        </div>
      )}
    </div>
  );
}
