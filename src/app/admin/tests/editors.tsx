'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import type { ActionState } from '@/server/courses';
import { startTest } from '@/server/tests';
import {
  createAssignmentAction,
  endAssignmentAction,
  grantAction,
  pullAudioAction,
  remarkAction,
  revokeAllowanceAction,
  toggleSetAction,
  tutorMarkAction,
  voidSittingAction,
} from '@/server/tests-admin';

const initial: ActionState = {};

/* ------------------------------------------------------------ import */

type Check = {
  formats: { formatCode: string; name: string; sets: { name: string; blocks: number; unknown: string[]; withoutKeys: string[] }[] }[];
  ignored: string[];
  problems: string[];
};
type Report = { formats: { formatCode: string; created: number; updated: number; blocks: number; audioDropped: number }[] };

export function ImportForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<string>();
  const [check, setCheck] = useState<Check | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function send(dryRun: boolean) {
    const file = input.current?.files?.[0];
    if (!file) return setError('Choose a file.');
    setBusy(dryRun ? 'check' : 'import');
    setError(undefined);
    setReport(null);
    try {
      const body = new FormData();
      body.set('file', file);
      if (dryRun) body.set('dryRun', '1');
      const r = await fetch('/admin/tests/import', { method: 'POST', body });
      const json = (await r.json().catch(() => ({}))) as { error?: string; check?: Check; report?: Report };
      if (!r.ok || json.error) setError(json.error ?? `The server answered ${r.status}.`);
      if (json.check) setCheck(json.check);
      if (json.report) {
        setReport(json.report);
        router.refresh();
      }
    } catch {
      setError('The file did not reach the server. Check the connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const issues = check?.formats.flatMap((f) => f.sets.filter((s) => s.withoutKeys.length || s.unknown.length).map((s) => ({ f, s }))) ?? [];
  return (
    <div className="space-y-4">
      <FormError message={error} />
      <Field label="Content file (JSON)" hint="The telc export (A1, A2, B1, B2 at the top), or any file keyed by test code. Sets already here are updated by name.">
        <input ref={input} type="file" accept="application/json,.json" className="t-small block" onChange={() => (setCheck(null), setReport(null))} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy != null} onClick={() => send(true)}>
          {busy === 'check' ? 'Reading…' : 'Check the file'}
        </Button>
        <Button type="button" disabled={busy != null || !check || !check.formats.length} onClick={() => send(false)}>
          {busy === 'import' ? 'Bringing it in…' : 'Bring it in'}
        </Button>
      </div>
      {check && (
        <div className="t-small space-y-2 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
          {check.formats.map((f) => (
            <p key={f.formatCode}>
              <b>{f.name}</b>: {f.sets.length} set{f.sets.length === 1 ? '' : 's'}, {f.sets.reduce((a, s) => a + s.blocks, 0)} parts
            </p>
          ))}
          {check.ignored.length > 0 && <p className="text-[var(--warn)]">Left out, not a known test: {check.ignored.join(', ')}</p>}
          {check.problems.map((p) => (
            <p key={p} className="text-[var(--warn)]">
              {p}
            </p>
          ))}
          {issues.slice(0, 12).map(({ f, s }) => (
            <p key={`${f.formatCode}-${s.name}`} className="text-[var(--warn)]">
              {f.name}, set {s.name}: {s.withoutKeys.length ? `no answer key in ${s.withoutKeys.join(', ')}` : ''}
              {s.withoutKeys.length && s.unknown.length ? '; ' : ''}
              {s.unknown.length ? `unknown parts ${s.unknown.join(', ')} left out` : ''}
            </p>
          ))}
          {issues.length > 12 && <p className="faint">and {issues.length - 12} more sets with the same kind of problem.</p>}
        </div>
      )}
      {report && (
        <FormSuccess
          message={report.formats
            .map((f) => `${f.formatCode}: ${f.created} new, ${f.updated} updated${f.audioDropped ? `, ${f.audioDropped} recordings dropped (their script changed)` : ''}`)
            .join(' · ')}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ recordings */

export function PullAudioButton({ formatCode, missing }: { formatCode: string; missing: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState<string>();
  const [skipped, setSkipped] = useState<string[]>([]);
  const stop = useRef(false);

  async function run() {
    setRunning(true);
    stop.current = false;
    setSkipped([]);
    let total = 0;
    try {
      for (let round = 0; round < 60 && !stop.current; round++) {
        const r = await pullAudioAction(formatCode);
        if ('error' in r && r.error) {
          setLine(r.error);
          break;
        }
        const rep = r as { pulled: number; remaining: number; skipped: string[] };
        total += rep.pulled;
        setSkipped(rep.skipped);
        setLine(`${total} brought over, ${rep.remaining} to go`);
        router.refresh();
        if (!rep.remaining || !rep.pulled) break;
      }
    } catch {
      setLine('The connection dropped. Press again to carry on.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => (stop.current = true)}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={!missing} onClick={run}>
            Bring recordings from the telc site
          </Button>
        )}
        {line && <span className="t-small muted">{line}</span>}
      </div>
      {skipped.length > 0 && (
        <details className="t-small">
          <summary className="faint">{skipped.length} not brought over</summary>
          <ul className="mt-1 list-disc pl-5">
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ sets */

export function SetToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant={active ? 'secondary' : 'primary'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await toggleSetAction(id, !active);
            setError(r.error);
            if (!r.error) router.refresh();
          })
        }
      >
        {active ? 'Take out of the draw' : 'Put in the draw'}
      </Button>
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
    </span>
  );
}

export function TryButton({ formatCode }: { formatCode: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startTest(formatCode, 'practice');
            if (r && !r.ok) setError(r.error);
          })
        }
      >
        {pending ? 'Opening…' : 'Try a paper'}
      </Button>
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
    </span>
  );
}

/* ------------------------------------------------------------ marking */

export function MarkForm({ submissionId, max, current, note }: { submissionId: string; max: number; current: number | null; note: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await tutorMarkAction(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, initial);
  return (
    <form action={action} className="mt-3 space-y-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label={`Your mark (0 to ${String(max).replace('.', ',')})`} hint="Half points allowed. Empty removes it.">
          <Input name="points" inputMode="decimal" defaultValue={current == null ? '' : String(current).replace('.', ',')} />
        </Field>
        <Field label="A note for the learner">
          <Textarea name="note" rows={2} defaultValue={note} maxLength={2000} />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save the mark'}
      </Button>
    </form>
  );
}

export function RemarkButton({ sittingId }: { sittingId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() =>
          start(async () => {
            const r = await remarkAction(sittingId);
            setMsg(r.error ?? r.message);
          })
        }
      >
        Ask the model again
      </Button>
      {msg && <span className="t-small muted">{msg}</span>}
    </span>
  );
}

export function VoidButton({ sittingId, spent }: { sittingId: string; spent: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  const [giveBack, setGiveBack] = useState(true);
  const [msg, setMsg] = useState<string>();
  if (!sure)
    return (
      <Button size="sm" variant="danger" onClick={() => setSure(true)}>
        Take this paper off
      </Button>
    );
  return (
    <div className="space-y-2 rounded-[var(--radius-sm)] border p-3">
      <p className="t-small">The paper leaves the learner&apos;s results and stops counting. This cannot be undone here.</p>
      {spent && <Checkbox label="Give the paper back to the learner's allowance" checked={giveBack} onChange={(e) => setGiveBack(e.target.checked)} />}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await voidSittingAction(sittingId, spent && giveBack);
              setMsg(r.error ?? r.message);
              if (!r.error) router.refresh();
            })
          }
        >
          Take it off
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
          Keep it
        </Button>
      </div>
      {msg && <p className="t-small muted">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ free papers */

export function GrantForm({ targets }: { targets: { value: string; label: string }[] }) {
  const router = useRouter();
  const [unlimited, setUnlimited] = useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await grantAction(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, initial);
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <Field label="Learners" hint="Email addresses or phone numbers, one per line or separated by commas. Up to 500.">
        <Textarea name="learners" rows={5} required placeholder={'asha@example.com\n9876543210'} />
      </Field>
      <Field label="Test">
        <Select name="target" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Papers">
          <Input name="tests" type="number" min={1} max={100} defaultValue={1} disabled={unlimited} />
        </Field>
        <Field label="Valid for (days)" hint="Empty for no end.">
          <Input name="days" type="number" min={1} max={730} />
        </Field>
      </div>
      <Checkbox name="unlimited" label="Unlimited papers" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
      <Field label="Note" hint="Why, for whoever looks later: a scholarship, a make-up, a demo.">
        <Input name="note" maxLength={300} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Giving…' : 'Give the papers'}
      </Button>
    </form>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revokeAllowanceAction(id);
            setError(r.error);
            if (!r.error) router.refresh();
          })
        }
      >
        Withdraw
      </Button>
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
    </span>
  );
}

/* ------------------------------------------------------------ set papers */

export function AssignmentForm({
  batches,
  formats,
}: {
  batches: { id: string; name: string }[];
  formats: { code: string; name: string; sections: { id: string; title: string }[] }[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(formats[0]?.code ?? '');
  const sections = formats.find((f) => f.code === code)?.sections ?? [];
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await createAssignmentAction(prev, fd);
    if (r.ok) router.refresh();
    return r;
  }, initial);
  if (!formats.length) return <p className="t-small muted">Bring in some content first; a paper can only be set from a test that has sets.</p>;
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <Field label="Batch">
        <Select name="batchId" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Test">
          <Select name="formatCode" value={code} onChange={(e) => setCode(e.target.value)}>
            {formats.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Part">
          <Select name="sectionId" defaultValue="">
            <option value="">The whole paper</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} only
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paper code" hint="Empty for a new paper. The same code gives the same paper, so a class sits the same thing.">
          <Input name="drawCode" maxLength={12} placeholder="e.g. K7M2QA" />
        </Field>
        <Field label="Due" hint="Optional.">
          <Input name="dueAt" type="date" />
        </Field>
      </div>
      <Field label="Title" hint="Optional; the test's name is used otherwise.">
        <Input name="title" maxLength={120} />
      </Field>
      <Field label="Note to the batch">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Setting…' : 'Set the paper'}
      </Button>
      <p className="t-small faint">A set paper does not use anybody&apos;s allowance, and only learners in the batch can open it.</p>
    </form>
  );
}

export function EndAssignmentButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await endAssignmentAction(id);
          if (!r.error) router.refresh();
        })
      }
    >
      Close it
    </Button>
  );
}
