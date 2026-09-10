'use client';

import { useActionState, useState } from 'react';
import { updateBranding, updateOrganisation } from '@/server/settings';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';
import { Uploader } from '@/components/uploader';
import {
  BUNDLED_BRAND_COLOR,
  BUNDLED_ICONS,
  BUNDLED_LOGOS,
  type BundledAsset,
} from '@/lib/brand-assets';
import { IMAGE_ACCEPT } from '@/lib/image-formats';

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

/**
 * The brand board, first.
 *
 * The deep purple is the product's own colour and what the interface is built
 * around; the amber is the accent, and setting it here would make every button
 * on every screen amber, which is the opposite of an accent. The older two are
 * kept because Medcity's other properties still use them.
 */
const PRESETS = [
  { value: '#322046', label: 'Medcity LMS purple' },
  { value: '#FDB85B', label: 'Medcity LMS amber (accent, not for buttons)' },
  { value: '#087447', label: 'medcitylms.in green' },
  { value: '#0B5294', label: 'medcityacademy.com blue' },
];

export function BrandingForm({
  brandColor,
  logoUrl,
  faviconUrl,
  storageReady = false,
}: {
  brandColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  storageReady?: boolean;
}) {
  const [state, action, pending] = useActionState(updateBranding, initial);
  const [colour, setColour] = useState(brandColor);
  const [logo, setLogo] = useState(logoUrl ?? '');
  const [favicon, setFavicon] = useState(faviconUrl ?? '');

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

        <ArtworkField
          label="Logo"
          hint="Shown in the site header. Blank uses the academy name as a wordmark."
          name="logoUrl"
          value={logo}
          onChange={setLogo}
          bundled={BUNDLED_LOGOS}
          storageReady={storageReady}
        />

        <ArtworkField
          label="Favicon"
          hint="The browser tab icon. Square works best."
          name="faviconUrl"
          value={favicon}
          onChange={setFavicon}
          bundled={BUNDLED_ICONS}
          storageReady={storageReady}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save branding'}
          </Button>

          {/* One press for the artwork and the colour it was drawn in, because
              a purple logo above a blue button is worse than either alone. */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setColour(BUNDLED_BRAND_COLOR);
              setLogo(BUNDLED_LOGOS[0].path);
              setFavicon(BUNDLED_ICONS[0].path);
            }}
          >
            Use the brand shipped with this build
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Artwork, three ways.
 *
 * Upload one, take the one shipped with the build, or paste a URL from wherever
 * the academy already keeps its files. The three exist because each fails in a
 * different situation: uploading needs storage configured, the bundled files
 * need a deployment, and a pasted URL needs somewhere to have pasted it from.
 */
function ArtworkField({
  label,
  hint,
  name,
  value,
  onChange,
  bundled,
  storageReady,
}: {
  label: string;
  hint: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  bundled: BundledAsset[];
  storageReady: boolean;
}) {
  const [mode, setMode] = useState<'bundled' | 'upload' | 'url'>(
    value && !value.startsWith('/brand/') ? 'url' : 'bundled',
  );

  return (
    <Field label={label} hint={hint}>
      <input type="hidden" name={name} value={value} />

      <div className="space-y-3">
        {value && (
          <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              className="h-10 w-auto max-w-40 object-contain"
            />
            <span className="t-micro faint min-w-0 flex-1 truncate">{value}</span>
            <button
              type="button"
              className="t-small faint hover:text-[var(--bad)]"
              onClick={() => onChange('')}
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {(['bundled', 'upload', 'url'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-[0.8125rem] transition ${
                mode === m
                  ? 'bg-[var(--brand)] text-[var(--brand-ink)]'
                  : 'border text-[var(--ink-2)] hover:border-[var(--ink-3)]'
              }`}
            >
              {m === 'bundled' ? 'Shipped with this build' : m === 'upload' ? 'Upload' : 'Paste a URL'}
            </button>
          ))}
        </div>

        {mode === 'bundled' && (
          <div className="grid gap-2 sm:grid-cols-2">
            {bundled.map((asset) => (
              <button
                key={asset.path}
                type="button"
                onClick={() => onChange(asset.path)}
                className={`flex items-center gap-3 rounded-[var(--radius-sm)] border p-2.5 text-left transition ${
                  value === asset.path ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:border-[var(--ink-3)]'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.path} alt="" className="h-8 w-auto max-w-24 object-contain" />
                <span className="min-w-0">
                  <span className="t-small block font-medium">{asset.label}</span>
                  <span className="t-micro faint block">{asset.note}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {mode === 'upload' &&
          (storageReady ? (
            <Uploader
              accept={IMAGE_ACCEPT}
              label={`Drop the ${label.toLowerCase()} here`}
              hint="PNG or SVG. It is stored like any other file in the library."
              onUploaded={(asset) => onChange(`/api/assets/${asset.id}`)}
            />
          ) : (
            <p className="t-small text-[var(--bad)]">
              File storage is not configured yet, so uploads cannot be stored. Use one of the files
              shipped with this build, or paste a URL.
            </p>
          ))}

        {mode === 'url' && (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://"
            aria-label={`${label} URL`}
          />
        )}
      </div>
    </Field>
  );
}
