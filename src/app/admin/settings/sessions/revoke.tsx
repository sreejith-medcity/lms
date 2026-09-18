'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revokeParentSessions, revokeStaffSessions } from '@/server/sessions-admin';
import { Button } from '@/components/ui';

export function RevokeButton({ kind, id, disabled }: { kind: 'parent' | 'staff'; id: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="text-right">
      {confirm ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = kind === 'parent' ? await revokeParentSessions(id) : await revokeStaffSessions(id);
                setNote(res.error ?? res.message);
                setConfirm(false);
                router.refresh();
              })
            }
          >
            {pending ? 'Ending...' : 'Yes, sign out everywhere'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" disabled={disabled || pending} onClick={() => setConfirm(true)}>
          Sign out everywhere
        </Button>
      )}
      {note && <p className="t-micro faint mt-1">{note}</p>}
    </div>
  );
}
