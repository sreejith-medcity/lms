'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePage, deletePost, savePage, savePost } from '@/server/storefront';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

interface Block {
  heading?: string;
  body?: string;
}

export function PageEditor({
  page,
}: {
  page?: {
    id: string;
    slug: string;
    title: string;
    status: string;
    seoTitle: string | null;
    seoDescription: string | null;
    blocks: Block[];
  };
}) {
  const [state, action, pending] = useActionState(savePage, initial);
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(
    page?.blocks.length ? page.blocks : [{ heading: '', body: '' }],
  );

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      {page && <input type="hidden" name="id" value={page.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Title">
          <Input name="title" defaultValue={page?.title} required maxLength={160} placeholder="About us" />
        </Field>
        <Field label="Address" hint="/about">
          <Input
            name="slug"
            defaultValue={page?.slug ?? 'about'}
            required
            maxLength={60}
            className="font-mono"
          />
        </Field>
      </div>

      <div className="space-y-3">
        <span className="t-small block font-medium">Sections</span>
        {blocks.map((b, i) => (
          <div key={i} className="space-y-2 rounded-[var(--radius-sm)] border p-3">
            <Input
              name="blockHeading"
              value={b.heading ?? ''}
              onChange={(e) =>
                setBlocks((all) => all.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))
              }
              maxLength={160}
              placeholder="Heading"
            />
            <Textarea
              name="blockBody"
              value={b.body ?? ''}
              onChange={(e) =>
                setBlocks((all) => all.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
              }
              rows={4}
              maxLength={4000}
              placeholder="The paragraph"
            />
            {blocks.length > 1 && (
              <button
                type="button"
                className="t-small faint underline"
                onClick={() => setBlocks((all) => all.filter((_, j) => j !== i))}
              >
                Remove this section
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="t-small faint underline"
          onClick={() => setBlocks((all) => [...all, { heading: '', body: '' }])}
        >
          Add a section
        </button>
      </div>

      <Field label="Search title" hint="Shown in Google. Up to 70 characters.">
        <Input name="seoTitle" defaultValue={page?.seoTitle ?? ''} maxLength={70} />
      </Field>

      <Field label="Search description" hint="Up to 180 characters.">
        <Textarea name="seoDescription" defaultValue={page?.seoDescription ?? ''} rows={2} maxLength={180} />
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label="Status">
            <Select name="status" defaultValue={page?.status ?? 'DRAFT'}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : page ? 'Save page' : 'Create page'}
        </Button>
        {page && (
          <a href="/admin/storefront" className="t-small faint underline">
            New instead
          </a>
        )}
      </div>
    </form>
  );
}

export function PostEditor({
  post,
}: {
  post?: {
    id: string;
    title: string;
    excerpt: string | null;
    bodyHtml: string;
    tags: string[];
    status: string;
  };
}) {
  const [state, action, pending] = useActionState(savePost, initial);
  const router = useRouter();
  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      {post && <input type="hidden" name="id" value={post.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Title" hint="The address comes from this.">
        <Input name="title" defaultValue={post?.title} required maxLength={180} />
      </Field>

      <Field label="Excerpt" hint="Shown on the blog index and in search results.">
        <Textarea name="excerpt" defaultValue={post?.excerpt ?? ''} rows={2} maxLength={300} />
      </Field>

      <Field label="Post">
        <Textarea name="bodyHtml" defaultValue={post?.bodyHtml} rows={12} required maxLength={40000} />
      </Field>

      <Field label="Tags" hint="Comma separated">
        <Input name="tags" defaultValue={post?.tags.join(', ')} maxLength={200} />
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label="Status">
            <Select name="status" defaultValue={post?.status ?? 'DRAFT'}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : post ? 'Save post' : 'Create post'}
        </Button>
        {post && (
          <a href="/admin/storefront" className="t-small faint underline">
            New instead
          </a>
        )}
      </div>
    </form>
  );
}

export function RemovePage({ id }: { id: string }) {
  return <Remove onRemove={() => deletePage(id)} />;
}

export function RemovePost({ id }: { id: string }) {
  return <Remove onRemove={() => deletePost(id)} />;
}

function Remove({ onRemove }: { onRemove: () => Promise<ActionState> }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await onRemove();
          router.refresh();
        })
      }
    >
      Delete
    </Button>
  );
}
