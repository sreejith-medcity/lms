'use client';

import { useCallback, useRef, useState } from 'react';
import { abandonUpload, completeUpload, requestUpload } from '@/server/assets';

export interface UploadedAsset {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

interface Job {
  key: string;
  fileName: string;
  sizeBytes: number;
  percent: number;
  status: 'uploading' | 'done' | 'error';
  message?: string;
}

/**
 * The browser talks to the bucket directly. This component only brokers the
 * signature and reports the outcome, so a 2 GB class recording never touches
 * the Node process and progress is real rather than a spinner that lies.
 */
export function Uploader({
  onUploaded,
  multiple = false,
  accept,
  label = 'Drop files here',
  hint = 'or click to choose. Video, audio, PDF, slides, images, zip.',
  disabled = false,
}: {
  onUploaded: (asset: UploadedAsset) => void;
  multiple?: boolean;
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);

  const patch = useCallback((key: string, next: Partial<Job>) => {
    setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...next } : j)));
  }, []);

  const upload = useCallback(
    async (file: File) => {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setJobs((all) => [
        ...all,
        { key, fileName: file.name, sizeBytes: file.size, percent: 0, status: 'uploading' },
      ]);

      const ticket = await requestUpload({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        patch(key, { status: 'error', message: ticket.error });
        return;
      }

      const { assetId, uploadUrl } = ticket;

      try {
        if (ticket.driver === 's3') {
          await putWhole(uploadUrl, file, (p) => patch(key, { percent: p }));
        } else {
          await putInChunks(uploadUrl, ticket.token ?? '', file, (p) => patch(key, { percent: p }));
        }
      } catch (err) {
        await abandonUpload(assetId);
        patch(key, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Upload failed.',
        });
        return;
      }

      const done = await completeUpload(assetId);
      if (done.error) {
        patch(key, { status: 'error', message: done.error });
        return;
      }

      patch(key, { status: 'done', percent: 100 });
      onUploaded({
        id: assetId,
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
    },
    [onUploaded, patch],
  );

  const take = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const files = Array.from(list).slice(0, multiple ? 20 : 1);
      files.forEach((f) => void upload(f));
    },
    [multiple, upload],
  );

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius)]
          border border-dashed px-6 py-8 text-center transition
          ${disabled ? 'cursor-not-allowed opacity-55' : 'hover:border-[var(--brand)]'}
          ${over ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'bg-[var(--surface)]'}`}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="mb-2 text-[var(--ink-3)]">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" strokeLinecap="round" />
        </svg>
        <p className="text-sm font-medium">{label}</p>
        <p className="t-small faint mt-0.5">{hint}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />

      {jobs.length > 0 && (
        <ul className="space-y-1.5">
          {jobs.map((job) => (
            <li key={job.key} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="t-small truncate">{job.fileName}</span>
                <span
                  className={`t-micro shrink-0 ${
                    job.status === 'error'
                      ? 'text-[var(--bad)]'
                      : job.status === 'done'
                        ? 'text-[var(--ok)]'
                        : 'faint'
                  }`}
                >
                  {job.status === 'done' ? 'Uploaded' : job.status === 'error' ? 'Failed' : `${job.percent}%`}
                </span>
              </div>

              {job.status === 'uploading' && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${job.percent}%`, background: 'var(--brand)' }}
                  />
                </div>
              )}

              {job.message && <p className="t-micro mt-1 text-[var(--bad)]">{job.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Transports -------------------------------------------------------------- */

/** One PUT straight at the bucket. XHR, because fetch still cannot report upload progress. */
function putWhole(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The storage bucket refused the upload (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('The upload was blocked. Check the bucket CORS rules.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

/**
 * Eight megabytes at a time to our own server. Shared hosting sits behind a proxy
 * with a body limit that a single 2 GB PUT would hit, and a dropped connection
 * here costs one chunk rather than the whole file. Each chunk is retried twice
 * before the upload is called off.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

async function putInChunks(
  url: string,
  token: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  let offset = 0;
  let attempts = 0;

  while (offset < file.size) {
    const blob = file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
    const isLast = offset + blob.size >= file.size;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-upload-token': token,
          'x-chunk-offset': String(offset),
          ...(isLast ? { 'x-upload-final': '1' } : {}),
        },
        body: blob,
      });
    } catch {
      // A dropped connection is worth another go. A refusal below is not.
      if (++attempts >= 4) throw new Error('The connection kept dropping during the upload.');
      await new Promise((r) => setTimeout(r, 800 * attempts));
      continue;
    }

    if (res.ok) {
      offset += blob.size;
      attempts = 0;
      onProgress(Math.round((offset / file.size) * 100));
      continue;
    }

    const body = (await res.json().catch(() => null)) as
      | { error?: string; received?: number }
      | null;

    // The server has more (or less) than we thought: an earlier attempt landed
    // and its reply was lost. Resume from where it says it is, rather than
    // appending the same bytes twice.
    if (res.status === 409 && typeof body?.received === 'number') {
      if (++attempts >= 4) throw new Error('The upload could not be resumed.');
      offset = body.received;
      onProgress(Math.round((offset / file.size) * 100));
      continue;
    }

    throw new Error(body?.error ?? `The server refused the upload (${res.status}).`);
  }
}
