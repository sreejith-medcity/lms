'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { issueCertificate, revokeCertificate, saveTemplate } from '@/server/certificates';
import type { ActionState } from '@/server/courses';
import { DEFAULT_DESIGN, MERGE_FIELDS, type CertificateDesign } from '@/lib/certificate';
import { Certificate } from '@/components/certificate';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function TemplateForm({
  academy,
  template,
}: {
  academy: string;
  template?: {
    id: string;
    name: string;
    serialPrefix: string;
    validityMonths: number | null;
    autoIssueOn: string;
    design: CertificateDesign;
    locked: boolean;
  };
}) {
  const [state, action, pending] = useActionState(saveTemplate, initial);
  const router = useRouter();
  const design = template?.design ?? DEFAULT_DESIGN;

  const [headline, setHeadline] = useState(design.headline);
  const [body, setBody] = useState(design.body);
  const [signatoryName, setSignatoryName] = useState(design.signatoryName);
  const [signatoryRole, setSignatoryRole] = useState(design.signatoryRole);
  const [showPreview, setShowPreview] = useState(false);

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      {template && <input type="hidden" name="id" value={template.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Template name" hint="Internal">
          <Input name="name" defaultValue={template?.name} required maxLength={120} placeholder="Course completion" />
        </Field>
        <Field label="Serial prefix" hint={template?.locked ? 'Fixed' : 'Fixed once issued'}>
          <Input
            name="serialPrefix"
            defaultValue={template?.serialPrefix ?? 'MIA'}
            required
            maxLength={12}
            readOnly={template?.locked}
            className="font-mono uppercase"
          />
        </Field>
      </div>

      <Field label="Headline">
        <Input
          name="headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          required
          maxLength={120}
        />
      </Field>

      <Field
        label="Body"
        hint={`Merge fields: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(' ')}`}
      >
        <Textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          maxLength={1000}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signed by">
          <Input
            name="signatoryName"
            value={signatoryName}
            onChange={(e) => setSignatoryName(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Their role">
          <Input
            name="signatoryRole"
            value={signatoryRole}
            onChange={(e) => setSignatoryRole(e.target.value)}
            maxLength={80}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valid for" hint="Months. 0 = never expires.">
          <Input
            name="validityMonths"
            type="number"
            min={0}
            max={600}
            defaultValue={template?.validityMonths ?? 0}
          />
        </Field>
        <Field label="Issue">
          <Select name="autoIssueOn" defaultValue={template?.autoIssueOn ?? 'MANUAL'}>
            <option value="MANUAL">By hand</option>
            <option value="COURSE_COMPLETION">Automatically on course completion</option>
          </Select>
        </Field>
      </div>

      <button
        type="button"
        className="t-small faint underline"
        onClick={() => setShowPreview((v) => !v)}
      >
        {showPreview ? 'Hide the preview' : 'Preview it'}
      </button>

      {showPreview && (
        <div className="overflow-hidden rounded-[var(--radius)] border">
          <Certificate
            design={{ headline, body, signatoryName, signatoryRole, accent: '' }}
            values={{
              learner: 'Aparna Menon',
              course: 'German Language - A1',
              academy,
              date: new Date().toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
              serial: `${template?.serialPrefix ?? 'MIA'}-00001`,
            }}
          />
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : template ? 'Save template' : 'Create template'}
      </Button>
    </form>
  );
}

export function IssueForm({
  enrollmentId,
  templates,
}: {
  enrollmentId: string;
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [error, setError] = useState<string>();

  return (
    <div className="flex shrink-0 items-center gap-2">
      {templates.length > 1 && (
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="h-8 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 text-[0.8125rem]"
          aria-label="Template"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        disabled={pending || !templateId}
        onClick={() =>
          start(async () => {
            const res = await issueCertificate(templateId, enrollmentId);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        {pending ? 'Issuing...' : 'Issue'}
      </Button>
      {error && <span className="t-small text-[var(--bad)]">{error}</span>}
    </div>
  );
}

export function RevokeButton({ id, serial }: { id: string; serial: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  if (!asking) {
    return (
      <button
        type="button"
        className="t-small text-[var(--bad)] underline"
        onClick={() => setAsking(true)}
      >
        Withdraw
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`Why is ${serial} being withdrawn?`}
        maxLength={200}
        className="text-xs"
      />
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={pending || reason.trim().length < 3}
          onClick={() =>
            start(async () => {
              const res = await revokeCertificate(id, reason.trim());
              setError(res.error);
              if (!res.error) {
                setAsking(false);
                router.refresh();
              }
            })
          }
        >
          Withdraw
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="t-small text-[var(--bad)]">{error}</p>}
    </div>
  );
}

export function VerifyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="flex items-center gap-2">
      <a href={`/verify/${token}`} target="_blank" rel="noreferrer noopener" className="t-small underline">
        View
      </a>
      <button
        type="button"
        className="t-small faint underline"
        onClick={() => {
          navigator.clipboard?.writeText(`${window.location.origin}/verify/${token}`);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </span>
  );
}
