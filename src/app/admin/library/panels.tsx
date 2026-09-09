'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAsset, renameAsset } from '@/server/assets';
import { Uploader } from '@/components/uploader';
import { Badge, Button, Card, Input, Select } from '@/components/ui';

export interface AssetRow {
  id: string;
  name: string;
  fileName: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
  pending: boolean;
  usedBy: number;
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function LibraryUploader() {
  const router = useRouter();
  return (
    <Uploader
      multiple
      onUploaded={() => router.refresh()}
      label="Drop files to add them to the library"
      hint="Up to 20 at a time. Video 4 GB, audio 1 GB, PDF 512 MB. Large files go up in chunks, so you can keep working."
    />
  );
}

/* Grid -------------------------------------------------------------------- */

const TYPE_FILTERS = ['ALL', 'VIDEO', 'AUDIO', 'PDF', 'IMAGE', 'DOC', 'SHEET', 'SLIDE', 'ZIP'];

export function AssetGrid({ assets }: { assets: AssetRow[] }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(
      (a) =>
        (type === 'ALL' || a.type === type) &&
        (!q || a.name.toLowerCase().includes(q) || a.fileName.toLowerCase().includes(q)),
    );
  }, [assets, query, type]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder="Search files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search files"
          />
        </div>
        <div className="w-44">
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            {TYPE_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t === 'ALL' ? 'All types' : t.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <span className="t-small faint">{visible.length} of {assets.length}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((a) => (
          <AssetCard key={a.id} asset={a} />
        ))}
      </div>
    </div>
  );
}

function AssetCard({ asset }: { asset: AssetRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);

  const preview = asset.type === 'IMAGE' && !asset.pending;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex h-28 items-center justify-center bg-[var(--surface-2)]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/assets/${asset.id}`} alt={asset.name} className="h-full w-full object-cover" />
        ) : (
          <TypeGlyph type={asset.type} />
        )}
      </div>

      <div className="space-y-2 p-4">
        {editing ? (
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} autoFocus />
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await renameAsset(asset.id, name);
                  setError(res.error);
                  if (!res.error) {
                    setEditing(false);
                    router.refresh();
                  }
                })
              }
            >
              Save
            </Button>
          </div>
        ) : (
          <button
            className="block w-full truncate text-left text-sm font-medium hover:underline"
            onClick={() => setEditing(true)}
            title="Rename"
          >
            {asset.name}
          </button>
        )}

        <p className="t-small faint truncate">{asset.fileName}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{asset.type.toLowerCase()}</Badge>
          <span className="t-small faint tabular-nums">{formatBytes(asset.sizeBytes)}</span>
          {asset.pending && <Badge tone="warn">upload unfinished</Badge>}
          {!asset.pending &&
            (asset.usedBy ? (
              <Badge tone="ok">used in {asset.usedBy}</Badge>
            ) : (
              <Badge tone="neutral">unused</Badge>
            ))}
        </div>

        {error && <p className="t-small text-[var(--bad)]">{error}</p>}

        <div className="flex gap-2 pt-1">
          <a
            href={`/api/assets/${asset.id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2.5 text-[0.8125rem] font-medium"
          >
            Open
          </a>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteAsset(asset.id);
                setError(res.error);
                if (!res.error) router.refresh();
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TypeGlyph({ type }: { type: string }) {
  const paths: Record<string, string> = {
    VIDEO: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5v11A1.5 1.5 0 0 1 13.5 19h-8A1.5 1.5 0 0 1 4 17.5zM15 10l5-3v10l-5-3z',
    AUDIO: 'M9 18V6l9-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm9-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    PDF: 'M6 3h7l5 5v13H6zM13 3v5h5',
  };
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--ink-3)]"
    >
      <path d={paths[type] ?? 'M6 3h7l5 5v13H6zM13 3v5h5'} />
    </svg>
  );
}

/* Where the bytes live ---------------------------------------------------- */

export function StorageStatus({ driver, root }: { driver: 'local' | 's3'; root: string }) {
  const [open, setOpen] = useState(false);

  if (driver === 's3') {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Object storage</p>
            <p className="t-small muted mt-0.5">
              Files upload straight from the browser to the bucket. The app server never
              handles them.
            </p>
          </div>
          <Badge tone="ok">connected</Badge>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <p className="text-sm font-medium">Server disk, behind the CDN</p>
          <p className="t-small muted mt-0.5">
            Files are written to <code>{root}</code> on the Hostinger server and served from a
            signed, permanently cacheable path, so the CDN answers every request after the
            first. Uploads arrive in 8 MB chunks to stay under the proxy body limit, and a
            dropped connection costs one chunk rather than the whole file.
          </p>
          <p className="t-small faint mt-2">
            This is the right footing for the demo. It is not the right footing for 281 GB of
            recordings: the plan disk fills, and every byte a learner streams burns server
            bandwidth and a worker process. Moving to Google Cloud Storage later is five
            environment variables and a file copy, because GCS speaks the same S3 API.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="warn">local disk</Badge>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Switch to a bucket'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t pt-4">
          <p className="t-small muted max-w-prose">
            Set these five and restart. Any S3-compatible endpoint works: Cloudflare R2
            (<code>https://&lt;account-id&gt;.r2.cloudflarestorage.com</code>, free egress),
            Google Cloud Storage (<code>https://storage.googleapis.com</code> with an HMAC key),
            AWS, Backblaze.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3 text-xs">
{`S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=medcity-lms
S3_ACCESS_KEY=...
S3_SECRET_KEY=...`}
          </pre>
          <p className="t-small muted mt-3 max-w-prose">
            The browser then uploads directly to the bucket, so the bucket needs a CORS rule
            allowing PUT from this site. Without it every upload is silently blocked:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3 text-xs">
{`[
  {
    "AllowedOrigins": ["https://demo.medcitylms.in"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]`}
          </pre>
          <p className="t-small faint mt-3">
            Files already on the server disk stay where they are. Copy them into the bucket
            under the same keys before switching, or they stop resolving.
          </p>
        </div>
      )}
    </Card>
  );
}
