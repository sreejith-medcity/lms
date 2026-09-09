'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addMaterial,
  addModule,
  addSection,
  cloneSection,
  deleteMaterial,
  deleteSection,
  moveMaterial,
  moveModule,
  moveSection,
  renameSection,
  setSectionVisible,
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

/* Section and module handling ---------------------------------------------- */

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] border text-xs transition
        disabled:cursor-not-allowed disabled:opacity-40
        ${danger ? 'text-[var(--bad)] hover:bg-[var(--bad-soft)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface)]'}`}
    >
      {children}
    </button>
  );
}

/**
 * The row of controls on a section header.
 *
 * Rename in place rather than in a dialog, because renaming a section is a
 * typo fix nine times in ten and a dialog turns that into four clicks.
 */
export function SectionControls({
  productId,
  section,
  canMoveUp,
  canMoveDown,
}: {
  productId: string;
  section: { id: string; title: string; isVisible: boolean; materialCount: number };
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [error, setError] = useState<string>();

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            run(() => renameSection(section.id, productId, title));
          }}
        >
          <Input
            value={title}
            autoFocus
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (title.trim() !== section.title) run(() => renameSection(section.id, productId, title));
            }}
            aria-label="Section title"
            className="h-8 max-w-sm py-1"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-left text-sm font-medium hover:underline"
          title="Rename"
        >
          {section.title}
          {!section.isVisible && (
            <span className="ml-2">
              <Badge tone="warn">hidden</Badge>
            </span>
          )}
        </button>
      )}

      <div className="flex items-center gap-1">
        {error && <span className="t-micro mr-1 text-[var(--bad)]">{error}</span>}
        <IconButton
          label="Move up"
          disabled={!canMoveUp || pending}
          onClick={() => run(() => moveSection(section.id, productId, 'up'))}
        >
          ↑
        </IconButton>
        <IconButton
          label="Move down"
          disabled={!canMoveDown || pending}
          onClick={() => run(() => moveSection(section.id, productId, 'down'))}
        >
          ↓
        </IconButton>
        <IconButton
          label={section.isVisible ? 'Hide from learners' : 'Show to learners'}
          disabled={pending}
          onClick={() => run(() => setSectionVisible(section.id, productId, !section.isVisible))}
        >
          {section.isVisible ? '👁' : '🚫'}
        </IconButton>
        <IconButton
          label="Duplicate this section and its materials"
          disabled={pending}
          onClick={() => run(() => cloneSection(section.id, productId))}
        >
          ⧉
        </IconButton>
        <IconButton
          label={
            section.materialCount > 0
              ? 'Empty the section before deleting it'
              : 'Delete this section'
          }
          danger
          disabled={pending || section.materialCount > 0}
          onClick={() => run(() => deleteSection(section.id, productId))}
        >
          ×
        </IconButton>
      </div>
    </div>
  );
}

export function ModuleOrder({
  productId,
  moduleId,
  canMoveUp,
  canMoveDown,
}: {
  productId: string;
  moduleId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function move(direction: 'up' | 'down') {
    start(async () => {
      await moveModule(productId, moduleId, direction);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <IconButton label="Move module up" disabled={!canMoveUp || pending} onClick={() => move('up')}>
        ↑
      </IconButton>
      <IconButton
        label="Move module down"
        disabled={!canMoveDown || pending}
        onClick={() => move('down')}
      >
        ↓
      </IconButton>
    </div>
  );
}
