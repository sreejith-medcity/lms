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

type Tab = 'notes' | 'transcript';

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
}) {
  const [tab, setTab] = useState<Tab>('notes');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  const isMedia = material.type === 'VIDEO' || material.type === 'AUDIO';
  const src = material.assetId ? `/api/assets/${material.assetId}` : null;

  return (
    <div className="min-w-0 flex-1">
      <div className="mx-auto max-w-3xl px-5 py-6">
        <p className="t-small faint">
          {material.typeLabel}
          {material.durationSeconds ? ` · ${formatDuration(material.durationSeconds)}` : ''}
          {` · ${position} of ${total}`}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{material.title}</h1>

        <div className="mt-5">
          {isMedia && src ? (
            <div
              ref={(node) => {
                mediaRef.current = node?.querySelector('video, audio') ?? null;
              }}
            >
              <MediaPlayer
                kind={material.type === 'VIDEO' ? 'video' : 'audio'}
                src={src}
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

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
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
          <div className="flex gap-1 border-b" role="tablist">
            {(['notes', 'transcript'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize transition ${
                  tab === t
                    ? 'border-[var(--brand)] font-medium'
                    : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'
                }`}
              >
                {t}
                {t === 'notes' && notes.length > 0 && (
                  <span className="t-micro faint ml-1.5 tabular-nums">{notes.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="py-5">
            {tab === 'notes' ? (
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
            ) : (
              <p className="t-small faint">
                Transcripts arrive with the AI layer, which turns a recording into something
                searchable rather than an hour you have to sit through again. Not built yet.
              </p>
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
