'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { attachRecording, cancelSession, markAttendance, removeRecording } from '@/server/sessions';
import { Badge, Button } from '@/components/ui';
import { Uploader } from '@/components/uploader';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

const OPTIONS: { value: Status; label: string }[] = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'LATE', label: 'Late' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'EXCUSED', label: 'Excused' },
];

export function AttendanceRow({
  sessionId,
  userId,
  name,
  email,
  status,
  joinedAt,
}: {
  sessionId: string;
  userId: string;
  name: string;
  email: string | null;
  status: string | null;
  joinedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string>();

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="t-body font-medium">{name}</p>
        <p className="t-small faint truncate">
          {email}
          {joinedAt &&
            ` · joined ${new Date(joinedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
        </p>
      </div>

      {error && <span className="t-small text-[var(--bad)]">{error}</span>}

      {current === 'PRESENT' && <Badge tone="ok">present</Badge>}
      {current === 'LATE' && <Badge tone="warn">late</Badge>}
      {current === 'EXCUSED' && <Badge>excused</Badge>}

      <div className="flex gap-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            disabled={pending}
            className={`rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition disabled:opacity-50 ${
              current === o.value ? 'border-[var(--brand)] text-[var(--brand)]' : 'muted hover:bg-[var(--surface-2)]'
            }`}
            onClick={() =>
              start(async () => {
                const res = await markAttendance(sessionId, userId, o.value);
                if (res.error) setError(res.error);
                else setCurrent(o.value);
              })
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </li>
  );
}

export function CancelSession({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
      <Button
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelSession(sessionId);
            if (res.error) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? 'Cancelling...' : 'Cancel class'}
      </Button>
    </div>
  );
}

/* Recordings -------------------------------------------------------------- */

export function Recordings({
  sessionId,
  recordings,
  storageReady,
}: {
  sessionId: string;
  recordings: { id: string; title: string; assetId: string; type: string }[];
  storageReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-3">
      {recordings.length > 0 && (
        <ul className="divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
          {recordings.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="t-small faint">{r.type.toLowerCase()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/api/assets/${r.assetId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2.5 text-[0.8125rem] font-medium"
                >
                  Play
                </a>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await removeRecording(r.id);
                      setError(res.error);
                      if (!res.error) router.refresh();
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="t-small text-[var(--bad)]">{error}</p>}

      {storageReady ? (
        <Uploader
          accept="video/*,audio/*"
          label="Drop the class recording here"
          hint="Learners in this batch can watch it straight after. Video up to 4 GB."
          onUploaded={(asset) =>
            start(async () => {
              const res = await attachRecording(sessionId, asset.id, asset.name);
              setError(res.error);
              if (!res.error) router.refresh();
            })
          }
        />
      ) : (
        <p className="t-small faint">
          Connect object storage in the media library to publish recordings here.
        </p>
      )}
    </div>
  );
}
