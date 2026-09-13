import { db } from '@/lib/db';
import type { $Enums } from '@prisma/client';
import { buildObjectKey, inferType, putObject, sanitiseFileName } from '@/lib/storage';
import { FIELD_FILE_MAX_BYTES, type FieldFile } from '@/lib/custom-fields';

/**
 * The server half of FILE custom fields: storing and clearing the upload.
 *
 * Kept apart from custom-fields.ts, which the custom-fields board imports in
 * the browser; anything that touches the bucket (node:fs, node:crypto) must
 * never be reachable from a client component.
 */

/**
 * Store an upload against a FILE field: an ID proof, a photograph, a
 * certificate handed in. One asset per field; a new upload replaces the
 * old value (the old asset stays in the library, since a document once
 * handed in is a record).
 */
export async function storeFieldFile(input: {
  organizationId: string;
  entity: $Enums.CustomFieldEntity;
  entityId: string;
  userId?: string | null;
  uploaderId: string;
  key: string;
  file: File;
}): Promise<{ ok: true; file: FieldFile } | { ok: false; error: string }> {
  const definition = await db.customFieldDefinition.findFirst({
    where: { organizationId: input.organizationId, entity: input.entity, key: input.key, isActive: true, type: 'FILE' },
    select: { id: true, label: true },
  });
  if (!definition) return { ok: false, error: 'That is not a file field.' };
  if (input.file.size === 0) return { ok: false, error: 'Pick a file first.' };
  if (input.file.size > FIELD_FILE_MAX_BYTES) return { ok: false, error: 'Keep the file under 15 MB.' };

  const fileName = sanitiseFileName(input.file.name || 'document');
  const objectKey = buildObjectKey(input.organizationId, fileName);
  const mime = input.file.type || 'application/octet-stream';
  await putObject(objectKey, new Uint8Array(await input.file.arrayBuffer()), mime);
  const asset = await db.asset.create({
    data: {
      organizationId: input.organizationId,
      name: `${definition.label}: ${fileName}`,
      fileName,
      type: inferType(fileName),
      storageKey: objectKey,
      mimeType: mime,
      sizeBytes: BigInt(input.file.size),
      uploadedById: input.uploaderId,
      transcodeStatus: 'READY',
    },
    select: { id: true },
  });
  const value: FieldFile = { assetId: asset.id, fileName, sizeBytes: input.file.size, uploadedAt: new Date().toISOString() };
  await db.customFieldValue.upsert({
    where: { definitionId_entityId: { definitionId: definition.id, entityId: input.entityId } },
    create: { definitionId: definition.id, entityId: input.entityId, userId: input.userId ?? null, value: value as never },
    update: { value: value as never },
  });
  return { ok: true, file: value };
}

export async function clearFieldFile(input: { organizationId: string; entity: $Enums.CustomFieldEntity; entityId: string; key: string }): Promise<boolean> {
  const definition = await db.customFieldDefinition.findFirst({
    where: { organizationId: input.organizationId, entity: input.entity, key: input.key, type: 'FILE' },
    select: { id: true },
  });
  if (!definition) return false;
  await db.customFieldValue.deleteMany({ where: { definitionId: definition.id, entityId: input.entityId } });
  return true;
}
