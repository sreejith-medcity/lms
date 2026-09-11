'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { MediaPlayer } from '@/components/media-player';
import { Card } from '@/components/ui';
import { CompleteButton } from './complete-button';
import { BookmarkButton, Notes, type NoteRow } from './notes';

interface Material {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  assetId: string | null;
  externalUrl: string | null;
  bodyHtml: string | null;
  isDownloadable: boolean;
  durationSeconds: number | null;
}

type Tab = 'overview' | 'notes' | 'announcements' | 'qa' | 'resources';

export interface StageAnnouncement {
  id: string;
  title: string;
  bodyHtml: string;
  publishedAt: string;
  urgent: boolean;
}

export interface StageResource {
  id: string;
  title: string;
  typeLabel: string;
  href: string;
}

/**
 * The lesson itself, plus everything that belongs beside it rather than under a
 * separate page. The player reports its current time up here so a note taken
 * while watching can be pinned to the second it was taken at, and clicking that
 * timestamp seeks back to it.
 */
export function Stage({
  productId,
  material,
  position,
  total,
  startAt,
  done,
  bookmarked,
  prevId,
  nextId,
  notes,
  watermark = null,
  blockContextMenu = false,
  allowDownload = true,
  courseTitle,
  courseDescription = null,
  sectionTitle = null,
  announcements = [],
  resources = [],
  discussionHref,
}: {
  productId: string;
  material: Material;
  position: number;
  total: number;
  startAt: number;
  done: boolean;
  bookmarked: boolean;
  prevId: string | null;
  nextId: string | null;
  notes: NoteRow[];
  /** Who is watching, when the academy has watermarking on. */
  watermark?: string | null;
  blockContextMenu?: boolean;
  allowDownload?: boolean;
  courseTitle: string;
  courseDescription?: string | null;
  sectionTitle?: string | null;
  announcements?: StageAnnouncement[];
  resources?: StageResource[];
  /** The course's discussion room. */
  discussionHref: string;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  const isMedia = material.type === 'VIDEO' || material.type === 'AUDIO';
  const src = material.assetId ? `/api/assets/${material.assetId}` : null;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'notes', label: 'Notes', count: notes.length || undefined },
    { key: 'announcements', label: 'Announcements', count: announcements.length || undefined },
    { key: 'qa', label: 'Q&A' },
    { key: 'resources', label: 'Resources', count: resources.length || undefined },
  ];

  return (
    <div className="min-w-0 flex-1">
      {/* The lesson, at the full width of the column. Video sits on black so
          letterboxing reads as intended rather than as a gap. */}
      <div className={isMedia && src ? 'bg-black' : 'border-b bg-[var(--surface)]'}>
        <div className={isMedia && src ? 'mx-auto max-w-[1100px]' : 'mx-auto max-w-4xl px-5 py-6'}>
          {isMedia && src ? (
            <div
              ref={(node) => {
                mediaRef.current = node?.querySelector('video, audio') ?? null;
              }}
              className="[&_video]:max-h-[70vh] [&_video]:w-full"
            >
              <MediaPlayer
                kind={material.type === 'VIDEO' ? 'video' : 'audio'}
                src={src}
                watermark={watermark}
                blockContextMenu={blockContextMenu}
                materialId={material.id}
                startAt={startAt}
                durationSeconds={material.durationSeconds}
                onTimeUpdate={setCurrentTime}
              />
            </div>
          ) : (
            <StaticViewer material={material} src={src} />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-5">
        <p className="t-small faint">
          {sectionTitle ? `${sectionTitle} · ` : ''}
          {material.typeLabel}
          {material.durationSeconds ? ` · ${formatDuration(material.durationSeconds)}` : ''}
          {` · ${position} of ${total}`}
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{material.title}</h1>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
          <div className="flex gap-2">
            {prevId && (
              <Link
                href={`/learn/${productId}/${prevId}`}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm font-medium"
              >
                Previous
              </Link>
            )}
            {nextId && (
              <Link
                href={`/learn/${productId}/${nextId}`}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm font-medium"
              >
                Next
              </Link>
            )}
            <BookmarkButton materialId={material.id} on={bookmarked} />
          </div>

          <CompleteButton
            productId={productId}
            materialId={material.id}
            done={done}
            nextHref={nextId ? `/learn/${productId}/${nextId}` : `/learn/${productId}`}
          />
        </div>

        <div className="mt-5">
          <div className="rail -mx-5 flex gap-1 border-b px-5" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition ${
                  tab === t.key
                    ? 'border-[var(--brand)] font-semibold'
                    : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
                }`}
              >
                {t.label}
                {t.count !== undefined && <span className="t-micro faint ml-1.5 tabular-nums">{t.count}</span>}
              </button>
            ))}
          </div>

          <div className="py-5">
            {tab === 'overview' && (
              <div className="space-y-4">
                <div>
                  <p className="t-small faint">About this course</p>
                  <p className="mt-1 text-base font-semibold">{courseTitle}</p>
                  {courseDescription && <p className="t-small muted mt-2 max-w-prose leading-relaxed">{courseDescription}</p>}
                </div>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="t-small faint">This lesson</dt>
                    <dd className="text-sm font-medium">{material.typeLabel}</dd>
                  </div>
                  {material.durationSeconds ? (
                    <div>
                      <dt className="t-small faint">Length</dt>
                      <dd className="text-sm font-medium">{formatDuration(material.durationSeconds)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="t-small faint">Position</dt>
                    <dd className="text-sm font-medium tabular-nums">{position} of {total}</dd>
                  </div>
                </dl>
                <p className="t-small faint">
                  Your place in a video is saved as you watch. A lesson counts as done when you press
                  Mark complete, or once you have watched most of it.
                </p>
              </div>
            )}

            {tab === 'announcements' && (
              announcements.length === 0 ? (
                <p className="t-small faint">Nothing from your trainer yet. Announcements for your batch and course appear here.</p>
              ) : (
                <ul className="space-y-4">
                  {announcements.map((a) => (
                    <li key={a.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{a.title}</p>
                        {a.urgent && <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>Important</span>}
                        <span className="t-small faint ml-auto">{a.publishedAt}</span>
                      </div>
                      <div className="prose prose-slate mt-2 max-w-none text-sm" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === 'qa' && (
              <div>
                <p className="t-small muted max-w-prose">
                  Ask the trainer and the rest of your batch in the course discussion. Questions are
                  answered there so everyone benefits from the answer.
                </p>
                <Link
                  href={discussionHref}
                  className="mt-3 inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
                  style={{ background: 'var(--brand)' }}
                >
                  Open the discussion
                </Link>
              </div>
            )}

            {tab === 'resources' && (
              resources.length === 0 ? (
                <p className="t-small faint">No downloads in this section.</p>
              ) : (
                <ul className="divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
                  {resources.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="t-micro faint">{r.typeLabel}</span>
                      </span>
                      <a href={r.href} download className="t-small shrink-0 font-semibold underline" style={{ color: 'var(--brand)' }}>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === 'notes' && (
              <Notes
                materialId={material.id}
                notes={notes}
                currentTime={isMedia && src ? (currentTime ?? 0) : null}
                onSeek={
                  isMedia && src
                    ? (seconds) => {
                        const el = mediaRef.current;
                        if (el) {
                          el.currentTime = seconds;
                          void el.play?.();
                        }
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaticViewer({ material, src }: { material: Material; src: string | null }) {
  if (src) {
    if (material.type === 'PDF' || material.type === 'EPUB') {
      return (
        <iframe
          src={src}
          title={material.title}
          className="h-[70vh] w-full rounded-[var(--radius)] border bg-[var(--surface)]"
        />
      );
    }

    if (material.type === 'IMAGE') {
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={material.title} className="mx-auto max-h-[70vh] w-auto" />
        </div>
      );
    }

    return (
      <Card>
        <p className="t-small muted">
          {MATERIAL_LABELS[material.type] ?? 'This file'} opens outside the player.
        </p>
        <a
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          Open
        </a>
      </Card>
    );
  }

  if (material.type === 'YOUTUBE' && material.externalUrl) {
    const embed = toYouTubeEmbed(material.externalUrl);
    if (embed) {
      return (
        <div className="aspect-video overflow-hidden rounded-[var(--radius)] border bg-black">
          <iframe
            src={embed}
            title={material.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    }
  }

  if (material.type === 'TEXT_HTML' && material.bodyHtml) {
    return (
      <Card>
        <div
          className="prose prose-slate max-w-none text-sm"
          dangerouslySetInnerHTML={{ __html: material.bodyHtml }}
        />
      </Card>
    );
  }

  if (material.externalUrl) {
    return (
      <Card>
        <p className="t-small muted">This material lives outside the platform.</p>
        <a
          href={material.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--brand)' }}
        >
          Open {MATERIAL_LABELS[material.type] ?? 'material'}
        </a>
      </Card>
    );
  }

  return (
    <Card>
      <p className="t-small muted">Nothing is attached to this lesson yet.</p>
      <p className="t-small faint mt-1">
        Your academy can see this too: it shows up on their dashboard as a lesson to fix.
      </p>
    </Card>
  );
}

function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    if (u.hostname.endsWith('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      if (u.pathname.startsWith('/embed/')) return `https://www.youtube-nocookie.com${u.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}
