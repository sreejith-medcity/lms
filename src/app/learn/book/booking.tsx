'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bookOneToOne, cancelOneToOne, offeredSlots, type SlotOffer } from '@/server/one-to-one';
import { Select } from '@/components/ui';

export function BookSlot({
  minutes,
  creditId,
  trainers,
}: {
  minutes: number;
  creditId: string;
  trainers: { id: string; name: string; headline: string | null }[];
}) {
  const [trainerId, setTrainerId] = useState('');
  const [slots, setSlots] = useState<SlotOffer[] | null>(null);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [working, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      <Select
        value={trainerId}
        onChange={(e) => {
          const id = e.target.value;
          setTrainerId(id);
          setSlots(null);
          setError(undefined);
          setDone(undefined);
          if (!id) return;
          start(async () => {
            setSlots(await offeredSlots({ trainerId: id, durationMinutes: minutes }));
          });
        }}
      >
        <option value="">Choose a trainer</option>
        {trainers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.headline ? ` · ${t.headline}` : ''}
          </option>
        ))}
      </Select>

      {working && !slots && <p className="t-small faint mt-3">Finding times...</p>}

      {slots && slots.length === 0 && (
        <p className="t-small mt-3">
          Nothing free in the next month with them. Try another trainer, or ask the academy.
        </p>
      )}

      {slots && slots.length > 0 && (
        <div className="mt-3 flex max-h-72 flex-wrap gap-2 overflow-y-auto">
          {slots.map((slot) => (
            <button
              key={slot.startsAt}
              type="button"
              disabled={working}
              className="rounded-full border px-3.5 py-1.5 text-sm transition hover:bg-[var(--surface-2)] disabled:opacity-60"
              onClick={() =>
                start(async () => {
                  const result = await bookOneToOne({
                    trainerId,
                    creditId: creditId || undefined,
                    startsAt: slot.startsAt,
                  });
                  if (result.ok) {
                    setDone(`Booked for ${slot.label}. ${result.message ?? ''}`.trim());
                    setError(undefined);
                    setSlots(null);
                    router.refresh();
                  } else {
                    setError(result.error);
                  }
                })
              }
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="t-small mt-3 text-[var(--bad)]">{error}</p>}
      {done && <p className="t-small mt-3">{done}</p>}
    </div>
  );
}

export function CancelMine({ sessionId }: { sessionId: string }) {
  const [working, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  return (
    <span>
      <button
        type="button"
        className="t-small faint underline"
        disabled={working}
        onClick={() =>
          start(async () => {
            const result = await cancelOneToOne(sessionId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {working ? '...' : 'cancel'}
      </button>
      {error && <span className="t-small ml-2 block text-[var(--bad)]">{error}</span>}
    </span>
  );
}
