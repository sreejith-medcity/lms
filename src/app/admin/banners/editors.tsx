'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBanner, setBannerActive, moveBanner, deleteBanner } from '@/server/marketing';
import type { ActionState } from '@/server/courses';
import { Uploader } from '@/components/uploader';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const initial: ActionState = {};

export function BannerCard({
  banner,
  canEdit,
  canMoveUp,
  canMoveDown,
}: {
  banner: {
    id: string;
    name: string;
    imageAssetId: string | null;
    linkUrl: string | null;
    isActive: boolean;
  };
  canEdit: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <Card padded={false} className={banner.isActive ? '' : 'opacity-60'}>
      {banner.imageAssetId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/assets/${banner.imageAssetId}`}
          alt={banner.name}
          className="aspect-[4/1] w-full rounded-t-[var(--radius)] object-cover"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{banner.name}</p>
          <p className="t-micro faint truncate">{banner.linkUrl ?? 'no link'}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !canMoveUp}
                aria-label="Move up"
                onClick={() => run(() => moveBanner(banner.id, 'up'))}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !canMoveDown}
                aria-label="Move down"
                onClick={() => run(() => moveBanner(banner.id, 'down'))}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => setBannerActive(banner.id, !banner.isActive))}
              >
                {banner.isActive ? 'Hide' : 'Show'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => deleteBanner(banner.id))}
              >
                Delete
              </Button>
            </>
          ) : (
            <Badge tone={banner.isActive ? 'ok' : 'neutral'}>
              {banner.isActive ? 'showing' : 'hidden'}
            </Badge>
          )}
        </div>
        {error && <p className="t-small w-full text-[var(--bad)]">{error}</p>}
      </div>
    </Card>
  );
}

export function NewBanner({ storageReady }: { storageReady: boolean }) {
  const [state, action, pending] = useActionState(saveBanner, initial);
  const [assetId, setAssetId] = useState('');
  const [fileName, setFileName] = useState('');

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="imageAssetId" value={assetId} />

      {storageReady ? (
        <Uploader
          accept="image/*"
          label="Drop the artwork here"
          hint="A wide image. It is shown at full width."
          onUploaded={(asset) => {
            setAssetId(asset.id);
            setFileName(asset.fileName);
          }}
        />
      ) : (
        <p className="t-small text-[var(--bad)]">
          File storage is not configured yet, so artwork cannot be uploaded.
        </p>
      )}

      {fileName && <p className="t-small muted">Using {fileName}.</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" hint="For your own team.">
          <Input name="name" required maxLength={120} placeholder="Onam offer strip" />
        </Field>
        <Field label="Links to" hint="Optional. A full URL.">
          <Input name="linkUrl" type="url" placeholder="https://…" />
        </Field>
        <Field label="Where it shows">
          <Select name="placement" defaultValue="LEARNER_HOME">
            <option value="LEARNER_HOME">Learner dashboard</option>
            <option value="SITE_HOME">Public home page</option>
            <option value="CATALOGUE">Course catalogue</option>
          </Select>
        </Field>
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending || !assetId}>
        {pending ? 'Saving…' : 'Add banner'}
      </Button>
    </form>
  );
}
