'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setDripRule } from '@/server/courses';
import { Badge, Card, Input, Select } from '@/components/ui';

type Anchor = 'NONE' | 'ENROLLMENT_DATE' | 'BATCH_START_DATE' | 'SPECIFIC_DATE';

interface Rule {
  anchor: string;
  offsetDays: number;
  releaseAt: string | null;
}

interface Material {
  id: string;
  title: string;
  typeLabel: string;
  rule: Rule | null;
}

const ANCHORS: { value: Anchor; label: string }[] = [
  { value: 'NONE', label: 'Open from the start' },
  { value: 'ENROLLMENT_DATE', label: 'After they enrol' },
  { value: 'BATCH_START_DATE', label: 'After the batch starts' },
  { value: 'SPECIFIC_DATE', label: 'On a date' },
];

export function DripTable({
  productId,
  modules,
  canEdit,
}: {
  productId: string;
  modules: {
    id: string;
    name: string;
    sections: { id: string; title: string; materials: Material[] }[];
  }[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      {modules.map((m) => (
        <Card key={m.id} padded={false}>
          <h3 className="border-b px-5 py-3 text-sm font-semibold">{m.name}</h3>
          {m.sections.map((s) => (
            <div key={s.id}>
              <p className="t-micro faint border-b bg-[var(--surface-2)] px-5 py-1.5 font-semibold uppercase tracking-wide">
                {s.title}
              </p>
              <ul className="divide-y">
                {s.materials.map((mat) => (
                  <DripRow key={mat.id} productId={productId} material={mat} canEdit={canEdit} />
                ))}
                {s.materials.length === 0 && (
                  <li className="t-small faint px-5 py-3">Nothing in this section.</li>
                )}
              </ul>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function DripRow({
  productId,
  material,
  canEdit,
}: {
  productId: string;
  material: Material;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [anchor, setAnchor] = useState<Anchor>((material.rule?.anchor as Anchor) ?? 'NONE');
  const [offset, setOffset] = useState(material.rule?.offsetDays ?? 0);
  const [date, setDate] = useState(material.rule?.releaseAt ?? '');
  const [error, setError] = useState<string>();

  function save(next: { anchor?: Anchor; offset?: number; date?: string }) {
    const a = next.anchor ?? anchor;
    const o = next.offset ?? offset;
    const d = next.date ?? date;

    start(async () => {
      const res = await setDripRule(productId, material.id, a, o, d || null);
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm">{material.title}</p>
        <p className="t-micro faint">{material.typeLabel}</p>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <Select
              value={anchor}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value as Anchor;
                setAnchor(next);
                save({ anchor: next });
              }}
              aria-label={`When ${material.title} opens`}
            >
              {ANCHORS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>

          {(anchor === 'ENROLLMENT_DATE' || anchor === 'BATCH_START_DATE') && (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={730}
                value={offset}
                disabled={pending}
                onChange={(e) => setOffset(Number(e.target.value) || 0)}
                onBlur={() => save({})}
                className="w-20"
                aria-label="Days"
              />
              <span className="t-small faint">days</span>
            </div>
          )}

          {anchor === 'SPECIFIC_DATE' && (
            <Input
              type="date"
              value={date}
              disabled={pending}
              onChange={(e) => {
                setDate(e.target.value);
                save({ date: e.target.value });
              }}
              className="w-40"
              aria-label="Opens on"
            />
          )}

          {error && <span className="t-small text-[var(--bad)]">{error}</span>}
        </div>
      ) : (
        <Badge tone={material.rule ? 'warn' : 'neutral'}>
          {material.rule ? 'scheduled' : 'open'}
        </Badge>
      )}
    </li>
  );
}
