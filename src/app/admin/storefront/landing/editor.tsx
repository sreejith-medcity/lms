'use client';

import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { importLandingFromUrl, saveLandingPage } from '@/server/landing';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

/**
 * One page, edited as text.
 *
 * The alternative was a block builder with drag handles. What an academy
 * actually does with an imported page is read it once, delete the paragraph
 * about last year's fees, fix a heading and publish, and that is what a
 * textarea is for. The format is written above the box rather than in a help
 * page nobody opens.
 */
export function LandingEditor({
  course,
  page,
}: {
  course: { id: string; title: string; slug: string };
  page?: {
    slug: string;
    title: string;
    status: string;
    seoTitle: string | null;
    seoDescription: string | null;
    source: string;
  };
}) {
  const [state, action, pending] = useActionState(saveLandingPage, initial);

  const [source, setSource] = useState(page?.source ?? '');
  const [title, setTitle] = useState(page?.title ?? course.title);
  const [slug, setSlug] = useState(page?.slug ?? '');

  const [url, setUrl] = useState('');
  const [importing, startImport] = useTransition();
  const [report, setReport] = useState<{ error?: string; lines: string[] } | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="t-heading">Import from the old site</h2>
        <p className="t-small muted mt-1">
          Paste the address of the existing page, for example
          https://medcitylms.in/nclex-rn-course/. The words, lists, questions and pictures come
          across into the box below, where you decide what to keep. Nothing is published by this.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://medcitylms.in/nclex-rn-course/"
            className="min-w-[16rem] flex-1"
            inputMode="url"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={importing || !url.trim()}
            onClick={() =>
              startImport(async () => {
                const result = await importLandingFromUrl(url);
                if (!result.ok) {
                  setReport({ error: result.error, lines: [] });
                  return;
                }
                setSource(result.source ?? '');
                if (result.title) setTitle(result.title);
                if (!slug && result.suggestedSlug) setSlug(result.suggestedSlug);
                setReport({
                  lines: [
                    `${result.blocks ?? 0} sections read.`,
                    `${result.images ?? 0} pictures brought across into your own storage.`,
                    ...(result.notes ?? []),
                  ],
                });
              })
            }
          >
            {importing ? 'Reading...' : 'Read that page'}
          </Button>
        </div>

        {report?.error && <p className="t-small mt-3 text-[var(--bad)]">{report.error}</p>}
        {report && report.lines.length > 0 && (
          <ul className="t-small muted mt-3 list-disc space-y-1 pl-5">
            {report.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <form action={action} className="space-y-4">
          <input type="hidden" name="courseId" value={course.id} />

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="t-heading">{course.title}</h2>
            {page && (
              <Link
                href={`/${page.slug}`}
                target="_blank"
                className="t-small underline"
                style={{ color: 'var(--brand)' }}
              >
                View the page
              </Link>
            )}
          </div>

          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />

          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="Page title">
              <Input
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={160}
              />
            </Field>
            <Field
              label="Address"
              hint="Keep the old one, so the ads and the search results still land."
            >
              <Input
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                maxLength={80}
                placeholder="nclex-rn-course"
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="The page"
            hint="## heading · plain paragraphs · - bullet · ? question and : answer · = 18 | branches · ![alt](https://…) · > call to action | button label"
          >
            <Textarea
              name="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={22}
              className="font-mono text-[0.8125rem]"
              placeholder={'## What this course is\n\nWhat the course does, in a paragraph.\n\n- Something they will be able to do\n\n? A question people ask\n: The answer.'}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Search title" hint="Left blank, the page title is used.">
              <Input name="seoTitle" defaultValue={page?.seoTitle ?? ''} maxLength={70} />
            </Field>
            <Field label="Search description" hint="Left blank, the first paragraph is used.">
              <Input
                name="seoDescription"
                defaultValue={page?.seoDescription ?? ''}
                maxLength={180}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Status">
              <Select name="status" defaultValue={page?.status ?? 'DRAFT'}>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </Select>
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <p className="t-small faint">
            Published, this page answers at its own address and renders as the course page, with
            these sections inside it. The course stays reachable at /course/{course.slug}, which
            points search engines at this address rather than competing with it.
          </p>
        </form>
      </Card>
    </div>
  );
}
