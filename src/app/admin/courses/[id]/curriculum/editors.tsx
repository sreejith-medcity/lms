'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  addMaterial,
  addModule,
  addSection,
  deleteMaterial,
  moveMaterial,
  unlinkModule,
} from '@/server/curriculum';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Field, FormError, Input, Select, brandStyle } from '@/components/ui';
import { Uploader, type UploadedAsset } from '@/components/uploader';

const initial: ActionState = {};

const LINK_TYPES: { value: string; label: string }[] = [
  { value: 'YOUTUBE', label: 'YouTube' },
  { value: 'LINK_EMBED', label: 'Link or embed' },
];


export function AddModule({
  productId,
  library,
}: {
  productId: string;
  library: { id: string; name: string; _count: { sections: number } }[];
}) {
  const [state, action, pending] = useActionState(addModule, initial);
  const [mode, setMode] = useState<'new' | 'library'>('new');

  return (
    <form action={action} className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
      <input type="hidden" name="productId" value={productId} />
      <FormError message={state.error} />

      <div className="mb-3 flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
          New module
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === 'library'}
            onChange={() => setMode('library')}
            disabled={library.length === 0}
          />
          From the library
          {library.length === 0 && <span className="t-small faint">(empty)</span>}
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {mode === 'new' ? (
          <div className="min-w-64 flex-1">
            <Field label="Module name">
              <Input name="name" placeholder="A1 Books" maxLength={120} />
            </Field>
          </div>
        ) : (
          <div className="min-w-64 flex-1">
            <Field label="Existing module" hint="Reused across courses, edited in one place">
              <Select name="moduleId" defaultValue="">
                <option value="" disabled>
                  Choose a module
                </option>
                {library.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m._count.sections} sections)
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Button type="submit" disabled={pending} style={brandStyle}>
          {pending ? 'Adding...' : 'Add module'}
        </Button>
      </div>
    </form>
  );
}

export function UnlinkModule({ productId, moduleId }: { productId: string; moduleId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
      <Button
        variant="secondary"
        disabled={pending}
        title="Removes it from this course. The module stays in the library."
        onClick={() => start(async () => setError((await unlinkModule(productId, moduleId)).error))}
      >
        {pending ? 'Removing...' : 'Remove from course'}
      </Button>
    </div>
  );
}

export function AddSection({ productId, moduleId }: { productId: string; moduleId: string }) {
  const [state, action, pending] = useActionState(addSection, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <div className="min-w-56 flex-1">
        <Field label="New section">
          <Input name="title" placeholder="Pronunciation and speaking basics" maxLength={160} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Adding...' : 'Add section'}
      </Button>
      <FormError message={state.error} />
    </form>
  );
}

export function AddMaterial({
  productId,
  sectionId,
  storageReady,
}: {
  productId: string;
  sectionId: string;
  storageReady: boolean;
}) {
  const [state, action, pending] = useActionState(addMaterial, initial);
  const [source, setSource] = useState<'file' | 'link'>(storageReady ? 'file' : 'link');
  const [linkType, setLinkType] = useState('YOUTUBE');
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [title, setTitle] = useState('');

  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={() => {
        // The form resets on success, so the picked file must not linger.
        setTimeout(() => setAsset(null), 0);
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="assetId" value={source === 'file' ? (asset?.id ?? '') : ''} />
      <input type="hidden" name="type" value={source === 'file' ? 'VIDEO' : linkType} />
      <FormError message={state.error} />

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={source === 'file'}
            onChange={() => setSource('file')}
            disabled={!storageReady}
          />
          Upload a file
          {!storageReady && <span className="t-small faint">(storage not connected)</span>}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={source === 'link'} onChange={() => setSource('link')} />
          Link or embed
        </label>
      </div>

      {source === 'file' &&
        (asset ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 py-2">
            <span className="t-small truncate">{asset.fileName}</span>
            <button
              type="button"
              className="t-small faint hover:underline"
              onClick={() => setAsset(null)}
            >
              Choose another
            </button>
          </div>
        ) : (
          <Uploader
            label="Drop the file here"
            hint="It uploads straight to storage. The material type is set from the file."
            onUploaded={(a) => {
              setAsset(a);
              setTitle((t) => t || a.name);
            }}
          />
        ))}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="Material">
            <Input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A1 Textbook (Kursbuch)"
              maxLength={160}
            />
          </Field>
        </div>

        {source === 'link' && (
          <>
            <div className="w-40">
              <Field label="Type">
                <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                  {LINK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-56 flex-1">
              <Field label="URL">
                <Input name="externalUrl" type="url" placeholder="https://" />
              </Field>
            </div>
          </>
        )}

        <div className="w-28">
          <Field label="Minutes">
            <Input name="durationMinutes" type="number" min={0} step={1} />
          </Field>
        </div>

        <label className="t-small muted flex items-center gap-2 pb-2">
          <input type="checkbox" name="isFreePreview" />
          Free preview
        </label>

        <label className="t-small muted flex items-center gap-2 pb-2">
          <input type="checkbox" name="isDownloadable" />
          Downloadable
        </label>

        <Button type="submit" variant="secondary" disabled={pending || (source === 'file' && !asset)}>
          {pending ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

export function MaterialRow({
  productId,
  material,
}: {
  productId: string;
  material: { id: string; title: string; type: string; isFreePreview: boolean; durationSeconds: number | null };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm">{material.title}</p>
        <p className="t-small faint">
          {material.type.replace('_', ' ').toLowerCase()}
          {material.durationSeconds ? ` · ${Math.round(material.durationSeconds / 60)} min` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {error && <span className="text-xs text-[var(--bad)]">{error}</span>}
        {material.isFreePreview && <Badge tone="ok">Free preview</Badge>}

        <button
          className="rounded border px-2 py-1 text-xs muted disabled:opacity-50"
          disabled={pending}
          onClick={() => start(async () => setError((await moveMaterial(material.id, productId, 'up')).error))}
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          className="rounded border px-2 py-1 text-xs muted disabled:opacity-50"
          disabled={pending}
          onClick={() => start(async () => setError((await moveMaterial(material.id, productId, 'down')).error))}
          aria-label="Move down"
        >
          ↓
        </button>
        <button
          className="rounded border border-[var(--bad)]/30 px-2 py-1 text-xs text-[var(--bad)] disabled:opacity-50"
          disabled={pending}
          onClick={() => start(async () => setError((await deleteMaterial(material.id, productId)).error))}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
