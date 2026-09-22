'use client';

import { useState } from 'react';
import { POSTER_TARGETS } from '@/lib/qr-targets';
import { Button, Field, Input, Select } from '@/components/ui';

/**
 * A QR code for the wall, the window or the counter, in the academy's
 * colours with its mark in the middle. Nothing is saved: the form builds
 * the address of the PDF and opens it, so every combination is a link
 * that can be bookmarked or printed again.
 */
export function QrPosterForm() {
  const [to, setTo] = useState('signup');
  const [path, setPath] = useState('');
  const [heading, setHeading] = useState('');
  const [line, setLine] = useState('');
  const [layout, setLayout] = useState<'poster' | 'labels'>('poster');
  const [copies, setCopies] = useState(8);
  const preset = POSTER_TARGETS.find((t) => t.key === to) ?? POSTER_TARGETS[0];

  const params = new URLSearchParams({ to, layout });
  if (to === 'path') params.set('path', path);
  if (heading.trim()) params.set('heading', heading.trim());
  if (line.trim()) params.set('line', line.trim());
  if (layout === 'labels') params.set('copies', String(copies));
  const href = `/api/qr/poster?${params.toString()}`;
  const pathOk = to !== 'path' || /^\/(?!\/)\S*$/.test(path.trim());

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="The code opens">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {POSTER_TARGETS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {to === 'path' ? (
          <Field label="Path on this site" hint="Starts with a slash: /course/german-a1, /blog/open-day.">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/course/german-a1" autoComplete="off" />
          </Field>
        ) : (
          <Field label="Layout">
            <Select value={layout} onChange={(e) => setLayout(e.target.value as 'poster' | 'labels')}>
              <option value="poster">A poster, one to a page</option>
              <option value="labels">Labels, eight to a page</option>
            </Select>
          </Field>
        )}
        <Field label="Heading" hint={preset.heading ? `Blank for "${preset.heading}".` : 'What the sheet says in large type.'}>
          <Input value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={80} placeholder={preset.heading || 'Scan me'} />
        </Field>
        <Field label="A line under the code" hint={preset.line ? `Blank for "${preset.line}".` : undefined}>
          <Input value={line} onChange={(e) => setLine(e.target.value)} maxLength={160} placeholder={preset.line || ''} />
        </Field>
        {to === 'path' && (
          <Field label="Layout">
            <Select value={layout} onChange={(e) => setLayout(e.target.value as 'poster' | 'labels')}>
              <option value="poster">A poster, one to a page</option>
              <option value="labels">Labels, eight to a page</option>
            </Select>
          </Field>
        )}
        {layout === 'labels' && (
          <Field label="How many labels" hint="Eight fill a page.">
            <Input type="number" min={1} max={40} value={copies} onChange={(e) => setCopies(Math.min(40, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!pathOk} onClick={() => window.open(href, '_blank', 'noopener')}>
          Open the PDF
        </Button>
        <span className="t-small faint">Opens in a new tab; print it from there. The code is drawn in the brand colour with the academy's mark in the middle.</span>
      </div>
    </div>
  );
}
