'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { checkLimit, meter } from '@/lib/usage';
import {
  buildObjectKey,
  deleteObject,
  headObject,
  inferType,
  maxBytesFor,
  presign,
  sanitiseFileName,
  storageConfigured,
} from '@/lib/storage';
import type { ActionState } from '@/server/courses';

/**
 * Uploads never pass through this server. The browser asks for a signed URL,
 * PUTs the bytes straight at the bucket, then tells us it finished and we
 * verify with a HEAD rather than trusting the number the client reported.
 * That is what keeps a 2 GB recording off a shared-hosting Node process.
 */

const UPLOAD_WINDOW_SECONDS = 60 * 60; // an hour, enough for a big file on Indian broadband

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const permission =
    action === 'delete' ? 'asset_library.delete_assets' : 'asset_library.upload_assets';
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to upload files.' };
  if (message === 'STORAGE_NOT_CONFIGURED') {
    return { error: 'File storage is not connected yet. Add the S3 settings and restart.' };
  }
  console.error('[assets]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export type UploadTicket =
  | { ok: true; assetId: string; uploadUrl: string }
  | { ok: false; error: string };

/**
 * Step one of an upload: reserve the Asset row and hand back a signed PUT.
 * The row exists in UPLOADING state so an abandoned upload is visible and
 * sweepable rather than an orphaned object nobody knows about.
 */
export async function requestUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  try {
    const { tenant, user } = await guard();
    if (!storageConfigured()) throw new Error('STORAGE_NOT_CONFIGURED');

    const fileName = sanitiseFileName(input.fileName || 'file');
    const size = Math.max(0, Math.round(Number(input.sizeBytes) || 0));
    if (!size) return { ok: false, error: 'That file looks empty.' };

    const type = inferType(fileName);
    const ceiling = maxBytesFor(type);
    if (size > ceiling) {
      return {
        ok: false,
        error: `${fileName} is larger than the ${Math.round(ceiling / 1024 ** 2)} MB limit for this file type.`,
      };
    }

    const limit = await checkLimit(tenant.tenantId, 'STORAGE_BYTES', size);
    if (!limit.allowed) {
      return { ok: false, error: 'Your plan storage is full. Remove files or upgrade to continue.' };
    }

    const storageKey = buildObjectKey(tenant.organizationId, fileName);

    const asset = await db.asset.create({
      data: {
        organizationId: tenant.organizationId,
        name: fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || fileName,
        fileName,
        type,
        storageKey,
        mimeType: input.mimeType || null,
        sizeBytes: BigInt(size),
        uploadedById: user.id,
        transcodeStatus: 'UPLOADING',
      },
      select: { id: true },
    });

    return {
      ok: true,
      assetId: asset.id,
      uploadUrl: presign('PUT', storageKey, UPLOAD_WINDOW_SECONDS),
    };
  } catch (err) {
    return { ok: false, error: fail(err).error };
  }
}

/** Step two: verify the object is really there, then bill the storage. */
export async function completeUpload(assetId: string): Promise<ActionState & { assetId?: string }> {
  try {
    const { tenant } = await guard();

    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId: tenant.organizationId },
      select: { id: true, storageKey: true, sizeBytes: true, mimeType: true },
    });
    if (!asset) return { error: 'That upload is no longer available.' };

    const head = await headObject(asset.storageKey);
    if (!head || !head.size) {
      return { error: 'The file did not finish uploading. Please try again.' };
    }

    await db.asset.update({
      where: { id: asset.id },
      data: {
        transcodeStatus: 'READY',
        sizeBytes: BigInt(head.size),
        mimeType: asset.mimeType ?? head.mimeType,
      },
    });

    await meter(tenant.tenantId, 'STORAGE_BYTES', head.size);

    revalidatePath('/admin/library');
    return { ok: true, assetId: asset.id };
  } catch (err) {
    return fail(err);
  }
}

/** The browser calls this when a PUT fails, so we do not leave a ghost row. */
export async function abandonUpload(assetId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    await db.asset.deleteMany({
      where: { id: assetId, organizationId: tenant.organizationId, transcodeStatus: 'UPLOADING' },
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function renameAsset(assetId: string, name: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const clean = name.trim().slice(0, 160);
    if (clean.length < 2) return { error: 'Give the file a name.' };

    const updated = await db.asset.updateMany({
      where: { id: assetId, organizationId: tenant.organizationId },
      data: { name: clean },
    });
    if (!updated.count) return { error: 'File not found.' };

    revalidatePath('/admin/library');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Deleting a file that a course still points at would break the course, so a
 * file in use is refused rather than silently unlinked.
 */
export async function deleteAsset(assetId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId: tenant.organizationId },
      select: {
        id: true,
        storageKey: true,
        sizeBytes: true,
        _count: { select: { materials: true, recordings: true } },
      },
    });
    if (!asset) return { error: 'File not found.' };

    if (asset._count.materials || asset._count.recordings) {
      const where = [
        asset._count.materials && `${asset._count.materials} material(s)`,
        asset._count.recordings && `${asset._count.recordings} recording(s)`,
      ]
        .filter(Boolean)
        .join(' and ');
      return { error: `This file is used by ${where}. Remove it there first.` };
    }

    await deleteObject(asset.storageKey);
    await db.asset.delete({ where: { id: asset.id } });
    await meter(tenant.tenantId, 'STORAGE_BYTES', -Number(asset.sizeBytes));

    revalidatePath('/admin/library');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
