'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelSession, markAttendance } from '@/server/sessions';
import { Badge, Button } from '@/components/ui';

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
