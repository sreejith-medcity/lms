'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { removeAvatar, saveDetails, uploadAvatar } from '@/server/account';
import { saveConsent } from '@/server/consent';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function AvatarForm({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [state, action, pending] = useActionState(uploadAvatar, initial);
  const [removing, startRemove] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const initialLetter = name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <form action={action} className="flex flex-col items-center text-center">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-28 w-28 rounded-full object-cover" />
      ) : (
        <span className="grid h-28 w-28 place-items-center rounded-full text-4xl font-bold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
          {initialLetter}
        </span>
      )}
      <p className="mt-3 font-semibold">{name}</p>
      <input
        ref={fileRef}
        type="file"
        name="photo"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) e.target.form?.requestSubmit();
        }}
      />
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => fileRef.current?.click()}>
          {pending ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Add a photo'}
        </Button>
        {avatarUrl && (
          <button type="button" className="t-small faint hover:underline" disabled={removing} onClick={() => startRemove(async () => void (await removeAvatar()))}>
            Remove
          </button>
        )}
      </div>
      <p className="t-micro faint mt-2">JPG, PNG or WebP, under 3 MB.</p>
      <div className="mt-2 w-full">
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />
      </div>
    </form>
  );
}

interface CustomField {
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  value: string;
}

export function DetailsForm({
  account,
  can,
  custom,
}: {
  account: Record<string, string>;
  can: { name: boolean; email: boolean; phone: boolean };
  custom: CustomField[];
}) {
  const [state, action, pending] = useActionState(saveDetails, initial);
  const [more, setMore] = useState(Boolean(account.parentName || account.permanentAddress || account.alternatePhone || account.parentPhone));

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint={can.name ? undefined : 'As on your enrolment.'}>
          <Input name="name" defaultValue={account.name} disabled={!can.name} maxLength={120} required />
        </Field>
        <Field label="Email" hint={can.email ? undefined : 'Where you sign in and receipts go.'}>
          <Input name="email" type="email" defaultValue={account.email} disabled={!can.email} maxLength={200} />
        </Field>
        <Field label="Mobile" hint={can.phone ? 'For class reminders.' : undefined}>
          <Input name="phone" type="tel" defaultValue={account.phone} disabled={!can.phone} maxLength={20} />
        </Field>
        <Field label="Alternate phone" hint="Optional">
          <Input name="alternatePhone" type="tel" defaultValue={account.alternatePhone} maxLength={20} />
        </Field>
        <Field label="Date of birth" hint="Optional">
          <Input name="dateOfBirth" type="date" defaultValue={account.dateOfBirth} />
        </Field>
        <Field label="Gender" hint="Optional">
          <Select name="gender" defaultValue={account.gender}>
            <option value="">Rather not say</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Occupation" hint="Student, nurse, working, at home">
          <Input name="occupation" defaultValue={account.occupation} maxLength={120} />
        </Field>
        <Field label="School or college" hint="Optional">
          <Input name="schoolOrCollege" defaultValue={account.schoolOrCollege} maxLength={160} />
        </Field>
        <Field label="Area or town">
          <Input name="area" defaultValue={account.area} maxLength={120} />
        </Field>
      </div>
      <Field label="Address" hint="Where you live now.">
        <Textarea name="residentialAddress" defaultValue={account.residentialAddress} rows={2} maxLength={400} />
      </Field>

      {custom.length > 0 && (
        <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          {custom.map((f) => (
            <Field key={f.key} label={f.label} hint={f.required ? undefined : 'Optional'}>
              {f.type === 'DROPDOWN' ? (
                <Select name={`cf_${f.key}`} defaultValue={f.value} required={f.required}>
                  <option value="">Pick one</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : f.type === 'MULTISELECT' ? (
                <Input name={`cf_${f.key}`} defaultValue={f.value} placeholder={f.options.join(', ')} maxLength={400} />
              ) : f.type === 'BOOLEAN' ? (
                <>
                  <input type="hidden" name="cf_booleans" value={f.key} />
                  <Checkbox name={`cf_${f.key}`} defaultChecked={f.value === 'true'} label="Yes" />
                </>
              ) : f.type === 'FILE' ? (
                <p className="t-small faint">Ask the office to attach this.</p>
              ) : (
                <Input name={`cf_${f.key}`} type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'} defaultValue={f.value} required={f.required} maxLength={200} />
              )}
            </Field>
          ))}
        </div>
      )}

      <div className="border-t pt-4">
        <button type="button" className="t-small font-medium underline" onClick={() => setMore((m) => !m)}>
          {more ? 'Hide' : 'Show'} parent or guardian and permanent address
        </button>
        {more && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Parent or guardian" hint="Optional">
              <Input name="parentName" defaultValue={account.parentName} maxLength={120} />
            </Field>
            <Field label="Their phone" hint="Optional">
              <Input name="parentPhone" type="tel" defaultValue={account.parentPhone} maxLength={20} />
            </Field>
            <Field label="Their email" hint="Optional">
              <Input name="parentEmail" type="email" defaultValue={account.parentEmail} maxLength={200} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Permanent address" hint="If different from where you live now.">
                <Textarea name="permanentAddress" defaultValue={account.permanentAddress} rows={2} maxLength={400} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save details'}
      </Button>
    </form>
  );
}

export function ConsentForm({ email, sms, whatsapp }: { email: boolean; sms: boolean; whatsapp: boolean }) {
  const [state, action, pending] = useActionState(saveConsent, initial);
  return (
    <form action={action} className="space-y-3">
      <Checkbox name="email" defaultChecked={email} label="Email" hint="News, offers and course nudges by email." />
      <Checkbox name="sms" defaultChecked={sms} label="SMS" />
      <Checkbox name="whatsapp" defaultChecked={whatsapp} label="WhatsApp" />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Saving...' : 'Save'}
      </Button>
    </form>
  );
}
