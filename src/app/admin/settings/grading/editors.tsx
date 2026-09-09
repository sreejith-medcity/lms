'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveGradeScale,
  useGradeScale,
  deleteGradeScale,
  seedDefaultScale,
} from '@/server/grading';
import type { ActionState } from '@/server/courses';
import { checkBands, gradeFor, type Band } from '@/lib/grading';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export function SeedButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await seedDefaultScale();
          router.refresh();
        })
      }
    >
      {pending ? 'Adding…' : 'Start from the standard bands'}
    </Button>
  );
}

export function ScaleCard({
  scale,
  canEdit,
}: {
  scale: { id: string; name: string; isActive: boolean; bands: Band[] };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [sample, setSample] = useState(72);

  const hit = gradeFor(sample, scale.bands);

  if (editing) {
    return <BandEditor scale={scale} onClose={() => setEditing(false)} />;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium">
            {scale.name}
            {scale.isActive && <Badge tone="ok">in use</Badge>}
          </p>
          <p className="t-micro faint">{scale.bands.length} bands</p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {!scale.isActive && (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await useGradeScale(scale.id);
                      setError(res.error);
                      if (!res.error) router.refresh();
                    })
                  }
                >
                  Use this one
                </Button>
                <button
                  type="button"
                  className="t-small faint hover:text-[var(--bad)]"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteGradeScale(scale.id);
                      setError(res.error);
                      if (!res.error) router.refresh();
                    })
                  }
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {scale.bands.map((b) => (
          <span
            key={b.grade}
            className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm ${
              hit?.grade === b.grade ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : ''
            }`}
          >
            <span className="font-semibold">{b.grade}</span>
            <span className="t-micro faint ml-1.5 tabular-nums">
              {b.minPercent}–{b.maxPercent}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="t-small faint">A score of</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={sample}
          className="w-20"
          aria-label="Sample score"
          onChange={(e) => setSample(Number(e.target.value) || 0)}
        />
        <span className="t-small">
          is{' '}
          {hit ? (
            <strong>
              {hit.grade}
              {hit.label ? ` — ${hit.label}` : ''}
              {hit.point != null ? ` (${hit.point} points)` : ''}
            </strong>
          ) : (
            <span className="text-[var(--bad)]">not covered by any band</span>
          )}
        </span>
      </div>

      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </Card>
  );
}

function BandEditor({
  scale,
  onClose,
}: {
  scale?: { id: string; name: string; bands: Band[] };
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveGradeScale, initial);
  const [bands, setBands] = useState<Band[]>(
    scale?.bands.length
      ? scale.bands
      : [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 60, maxPercent: 79 },
          { grade: 'C', minPercent: 40, maxPercent: 59 },
          { grade: 'F', minPercent: 0, maxPercent: 39 },
        ],
  );

  // Checked as you type, because a gap between 79 and 80 is invisible until the
  // day somebody scores in it and their report card comes out blank.
  const problems = checkBands(bands);

  function update(i: number, changes: Partial<Band>) {
    setBands((all) => all.map((b, index) => (index === i ? { ...b, ...changes } : b)));
  }

  return (
    <Card>
      <form action={action} className="space-y-4">
        {scale && <input type="hidden" name="id" value={scale.id} />}

        <Field label="Scale name">
          <Input name="name" required defaultValue={scale?.name ?? ''} maxLength={60} placeholder="Standard" />
        </Field>

        <div className="space-y-2">
          <div className="t-micro faint grid grid-cols-[80px_90px_90px_90px_1fr_auto] gap-2 font-semibold uppercase tracking-wide">
            <span>Grade</span>
            <span>From</span>
            <span>To</span>
            <span>Points</span>
            <span>Means</span>
            <span />
          </div>

          {bands.map((band, i) => (
            <div key={i} className="grid grid-cols-[80px_90px_90px_90px_1fr_auto] items-center gap-2">
              <Input
                name="grade"
                value={band.grade}
                maxLength={8}
                onChange={(e) => update(i, { grade: e.target.value })}
              />
              <Input
                name="minPercent"
                type="number"
                min={0}
                max={100}
                value={band.minPercent}
                onChange={(e) => update(i, { minPercent: Number(e.target.value) })}
              />
              <Input
                name="maxPercent"
                type="number"
                min={0}
                max={100}
                value={band.maxPercent}
                onChange={(e) => update(i, { maxPercent: Number(e.target.value) })}
              />
              <Input
                name="point"
                type="number"
                step="0.1"
                value={band.point ?? ''}
                onChange={(e) =>
                  update(i, { point: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
              <Input
                name="bandLabel"
                value={band.label ?? ''}
                maxLength={60}
                placeholder="Very good"
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={bands.length <= 1}
                onClick={() => setBands((all) => all.filter((_, index) => index !== i))}
              >
                ×
              </Button>
            </div>
          ))}
        </div>

        {problems.length > 0 && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--bad)]/25 bg-[var(--bad-soft)] p-3">
            <p className="t-small font-medium text-[var(--bad)]">
              This cannot be saved yet:
            </p>
            <ul className="t-small mt-1 list-disc pl-5 text-[var(--bad)]">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        )}

        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setBands((all) => [...all, { grade: '', minPercent: 0, maxPercent: 0 }])}
          >
            Add a band
          </Button>
          <Button type="submit" disabled={pending || problems.length > 0}>
            {pending ? 'Saving…' : 'Save scale'}
          </Button>
          <button type="button" className="t-small faint hover:underline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

export function NewScale() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add a scale
      </Button>
    );
  }
  return <BandEditor onClose={() => setOpen(false)} />;
}
