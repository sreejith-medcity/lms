'use client';

import { useActionState, useState } from 'react';
import { updateBranding, updateOrganisation } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

/** A handful of the zones an Indian academy actually operates in. */
const TIMEZONES = ['Asia/Calcutta', 'Asia/Dubai', 'Europe/Berlin', 'Europe/London', 'UTC'];

export function OrganisationForm({
  org,
}: {
  org: {
    name: string;
    legalName: string | null;
    website: string | null;
    supportEmail: string | null;
    contactNumber: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    timezone: string;
    currency: string;
  };
}) {
  const [state, action, pending] = useActionState(updateOrganisation, initial);

  return (
    <Card>
      <h2 className="t-heading">Academy details</h2>
      <p className="t-small muted mt-1">
        This is what learners see in the header, the footer, on invoices and in every email the
        platform sends.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="Shown everywhere learners look">
            <Input name="name" defaultValue={org.name} required maxLength={160} />
          </Field>
          <Field label="Legal name" hint="Used on invoices, if it differs">
            <Input name="legalName" defaultValue={org.legalName ?? ''} maxLength={200} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email">
            <Input name="supportEmail" type="email" defaultValue={org.supportEmail ?? ''} />
          </Field>
          <Field label="Phone">
            <Input name="contactNumber" type="tel" defaultValue={org.contactNumber ?? ''} />
          </Field>
        </div>

        <Field label="Website">
          <Input name="website" type="url" defaultValue={org.website ?? ''} placeholder="https://" />
        </Field>

        <Field label="Address">
          <Input name="addressLine" defaultValue={org.addressLine ?? ''} maxLength={240} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City">
            <Input name="city" defaultValue={org.city ?? ''} />
          </Field>
          <Field label="State">
            <Input name="state" defaultValue={org.state ?? ''} />
          </Field>
          <Field label="Pincode">
            <Input name="pincode" defaultValue={org.pincode ?? ''} maxLength={12} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone" hint="Class times are shown in this zone">
            <Select name="timezone" defaultValue={org.timezone}>
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" hint="Three letter code. Changing it does not convert past orders.">
            <Input name="currency" defaultValue={org.currency} maxLength={3} />
          </Field>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </Card>
  );
}

/** The two brand colours already in use across Medcity's properties. */
const PRESETS = [
  { value: '#087447', label: 'medcitylms.in green' },
  { value: '#0B5294', label: 'medcityacademy.com blue' },
];

export function BrandingForm({
  brandColor,
  logoUrl,
  faviconUrl,
}: {
  brandColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}) {
  const [state, action, pending] = useActionState(updateBranding, initial);
  const [colour, setColour] = useState(brandColor);

  return (
    <Card>
      <h2 className="t-heading">Branding</h2>
      <p className="t-small muted mt-1">
        One accent colour drives the entire product: buttons, links, charts, the learner portal and
        the public site. There is no second palette to keep in step.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <Field label="Accent colour">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              aria-label="Pick the accent colour"
              className="h-10 w-12 cursor-pointer rounded-[var(--radius-sm)] border bg-[var(--surface)] p-1"
            />
            <Input
              name="brandColor"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              maxLength={7}
              className="font-mono"
            />
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setColour(p.value)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.8125rem] transition ${
                colour.toLowerCase() === p.value.toLowerCase()
                  ? 'border-[var(--ink-3)]'
                  : 'hover:border-[var(--ink-3)]'
              }`}
            >
              <span
                aria-hidden
                className="h-3 w-3 rounded-full"
                style={{ background: p.value }}
              />
              {p.label}
            </button>
          ))}
        </div>

        {/* Live, so the choice is made by looking rather than by imagining. */}
        <div className="rounded-[var(--radius)] border p-4" style={{ background: 'var(--surface-2)' }}>
          <p className="t-micro faint uppercase tracking-wide">Preview</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-medium text-white"
              style={{ background: colour }}
            >
              Enrol now
            </span>
            <span className="text-sm font-medium" style={{ color: colour }}>
              A link
            </span>
            <span className="flex h-8 items-end gap-1">
              {[40, 70, 55, 90].map((h, i) => (
                <span
                  key={i}
                  className="w-3 rounded-t-[3px]"
                  style={{ height: `${h}%`, background: colour }}
                />
              ))}
            </span>
          </div>
        </div>

        <Field label="Logo URL" hint="Optional. Leave blank to use the academy name as a wordmark.">
          <Input name="logoUrl" type="url" defaultValue={logoUrl ?? ''} placeholder="https://" />
        </Field>

        <Field label="Favicon URL" hint="Optional.">
          <Input name="faviconUrl" type="url" defaultValue={faviconUrl ?? ''} placeholder="https://" />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save branding'}
        </Button>
      </form>
    </Card>
  );
}
