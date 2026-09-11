'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generatePaper, previewPaper, type PaperPreview } from '@/server/papers';
import { Badge, Button, Card, Field, FormError, Input, Select } from '@/components/ui';

interface SectionDraft {
  key: number;
  label: string;
  count: number;
  bankId: string;
  tags: string;
  anyTag: boolean;
  difficulty: '' | 'EASY' | 'MEDIUM' | 'HARD';
}

let nextKey = 1;
const blank = (bankId = ''): SectionDraft => ({
  key: nextKey++,
  label: '',
  count: 10,
  bankId,
  tags: '',
  anyTag: false,
  difficulty: '',
});

/**
 * The recipe form. Sections are rows; the preview answers "can the bank
 * supply this" before a paper exists, which is the question that decides
 * whether to change the recipe or write more questions.
 */
export function PaperGenerator({
  banks,
  tags,
  defaultBankId,
}: {
  banks: { id: string; name: string; count: number }[];
  tags: { name: string; count: number }[];
  defaultBankId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'MOCK_EXAM' | 'TEST' | 'PRACTICE'>('MOCK_EXAM');
  const [duration, setDuration] = useState(60);
  const [pass, setPass] = useState(40);
  const [attempts, setAttempts] = useState(1);
  const [sections, setSections] = useState<SectionDraft[]>([blank(defaultBankId ?? '')]);
  const [preview, setPreview] = useState<PaperPreview>();
  const [error, setError] = useState<string>();

  const payload = () => ({
    title,
    kind,
    durationMinutes: duration,
    passPercent: pass,
    maxAttempts: attempts,
    shuffleQuestions: true,
    sections: sections.map((s, i) => ({
      label: s.label || `Section ${i + 1}`,
      count: s.count,
      bankIds: s.bankId ? [s.bankId] : [],
      tags: s.tags.split(',').map((t) => t.trim()).filter(Boolean),
      anyTag: s.anyTag,
      difficulty: s.difficulty || null,
    })),
  });

  const update = (key: number, patch: Partial<SectionDraft>) => {
    setSections((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setPreview(undefined);
  };

  const total = sections.reduce((n, s) => n + (Number(s.count) || 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="t-heading">The paper</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="NCLEX-RN mock 4" required />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="MOCK_EXAM">Mock exam</option>
              <option value="TEST">Test</option>
              <option value="PRACTICE">Practice set</option>
            </Select>
          </Field>
          <Field label="Duration" hint="Minutes. 0 for untimed.">
            <Input type="number" min={0} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
          <Field label="Pass mark" hint="Percent">
            <Input type="number" min={0} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} />
          </Field>
          <Field label="Attempts allowed">
            <Input type="number" min={1} max={50} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-heading">Sections</h2>
          <span className="t-small faint tabular-nums">{total} questions in total</span>
        </div>
        <p className="t-small muted mt-1">
          Each section draws its questions at random from whatever matches. Leave a field empty to mean any.
        </p>

        <div className="mt-4 space-y-3">
          {sections.map((s, i) => (
            <div key={s.key} className="rounded-[var(--radius-sm)] border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                <Field label="Section name">
                  <Input value={s.label} placeholder={`Section ${i + 1}`} onChange={(e) => update(s.key, { label: e.target.value })} />
                </Field>
                <Field label="Questions">
                  <Input type="number" min={1} max={500} value={s.count} onChange={(e) => update(s.key, { count: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Bank">
                  <Select value={s.bankId} onChange={(e) => update(s.key, { bankId: e.target.value })}>
                    <option value="">Any bank</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.count})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tags" hint="Comma separated">
                  <Input list="tag-list" value={s.tags} placeholder="pharmacology, cardiac" onChange={(e) => update(s.key, { tags: e.target.value })} />
                </Field>
                <Field label="Difficulty">
                  <Select value={s.difficulty} onChange={(e) => update(s.key, { difficulty: e.target.value as SectionDraft['difficulty'] })}>
                    <option value="">Any</option>
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="t-small flex items-center gap-2">
                  <input type="checkbox" checked={s.anyTag} onChange={(e) => update(s.key, { anyTag: e.target.checked })} />
                  Any one of the tags is enough (otherwise a question needs all of them)
                </label>
                {sections.length > 1 && (
                  <button
                    type="button"
                    className="t-small underline"
                    onClick={() => {
                      setSections((rows) => rows.filter((r) => r.key !== s.key));
                      setPreview(undefined);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <datalist id="tag-list">
          {tags.map((t) => (
            <option key={t.name} value={t.name}>{`${t.count} questions`}</option>
          ))}
        </datalist>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSections((rows) => [...rows, blank(rows[rows.length - 1]?.bankId ?? '')]);
              setPreview(undefined);
            }}
          >
            Add a section
          </Button>
        </div>
      </Card>

      <FormError message={error} />

      {preview?.ok && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-heading">What the bank can supply</h2>
            <Badge tone={preview.shortfalls.length ? 'warn' : 'ok'}>
              {preview.drawn} of {total} drawn · {preview.totalMarks} marks
            </Badge>
          </div>
          <ul className="mt-3 space-y-1.5">
            {preview.sections.map((s, i) => {
              const short = preview.shortfalls.find((x) => x.label === s.label);
              return (
                <li key={i} className="t-small flex flex-wrap items-center justify-between gap-2">
                  <span>{s.label}</span>
                  <span className="tabular-nums">
                    {s.available} available for {s.wanted} wanted
                    {short && <Badge tone="warn"> only {short.drawn} after other sections</Badge>}
                  </span>
                </li>
              );
            })}
          </ul>
          {preview.shortfalls.length > 0 && (
            <p className="t-small mt-3 text-[var(--warn)]">
              A short section is generated with what there is, not padded from elsewhere. Lower the count, loosen the
              tags, or import more questions.
            </p>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !sections.length}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const res = await previewPaper(payload());
              if (!res.ok) setError(res.error);
              setPreview(res);
            })
          }
        >
          {pending ? 'Checking...' : 'Check availability'}
        </Button>
        <Button
          type="button"
          disabled={pending || !title.trim()}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const res = await generatePaper(payload());
              if (res.error) setError(res.error);
              else if (res.id) router.push(`/admin/assessments/${res.id}`);
            })
          }
        >
          {pending ? 'Drawing...' : 'Generate the paper'}
        </Button>
      </div>
    </div>
  );
}
