import { db } from '@/lib/db';
import {
  buildObjectKey,
  inferMimeType,
  inferType,
  putObject,
  sanitiseFileName,
} from '@/lib/storage';
import { IMAGE_MIME_TYPES } from '@/lib/image-formats';

/**
 * Pulling a picture off the old site and making it ours.
 *
 * Every import that brings content across has the same problem underneath it:
 * the words come over but the images stay on a server we are about to switch
 * off. So each one is fetched once, checked, stored through the same file
 * layer everything else uses and given an Asset row, after which the old host
 * can go dark without leaving holes in the pages.
 *
 * A failure here is never fatal to the import that called it. It comes back
 * as a sentence for the person reviewing, because a missing picture is worth
 * knowing about and is not worth losing three hundred words over.
 */

/** Big enough for page artwork, small enough that it cannot exhaust memory. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImagePull = { assetId: string } | { problem: string };

export async function fetchImageAsAsset(
  url: string,
  organizationId: string,
  uploadedById: string,
): Promise<ImagePull> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'image/*' },
    });
  } catch {
    return { problem: `could not reach ${url}` };
  }

  if (!response.ok) return { problem: `${url} answered ${response.status}` };

  const declared = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (declared && !IMAGE_MIME_TYPES.includes(declared as (typeof IMAGE_MIME_TYPES)[number])) {
    return { problem: `${url} is ${declared}, which is not an image format we take` };
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) return { problem: `${url} came back empty` };
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { problem: `${url} is larger than 8 MB, so it was skipped` };
  }

  const fileName = sanitiseFileName(
    decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image'),
  );
  const key = buildObjectKey(organizationId, fileName);
  const mimeType = declared || inferMimeType(fileName);

  await putObject(key, buffer, mimeType);

  const asset = await db.asset.create({
    data: {
      organizationId,
      name: fileName,
      fileName,
      type: inferType(fileName),
      storageKey: key,
      mimeType,
      sizeBytes: BigInt(buffer.byteLength),
      uploadedById,
      transcodeStatus: 'READY',
    },
    select: { id: true },
  });

  return { assetId: asset.id };
}
