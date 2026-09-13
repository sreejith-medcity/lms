import { db } from '@/lib/db';
import { getObject, inferMimeType, putObject } from '@/lib/storage';
import { readZip } from './zip';
import { findManifest, launchQuery, parseImsManifest, parseTincan, safeRelativePath, type PackageInfo } from './manifest';

/**
 * A zip in the bucket becomes a package: its files copied out one by one
 * under a prefix of their own, the manifest read, the material turned into
 * an interactive lesson. The zip stays where it was, so the office can
 * download what they uploaded.
 */

const MAX_ZIP = 1024 ** 3;
const MAX_FILES = 5000;

export interface UnpackResult {
  packageId: string;
  info: PackageInfo;
  fileCount: number;
}

/** Whether a zip looks like a package at all, from its names alone. */
export async function sniffPackage(assetId: string, organizationId: string): Promise<boolean> {
  const asset = await db.asset.findFirst({ where: { id: assetId, organizationId }, select: { storageKey: true, sizeBytes: true } });
  if (!asset || Number(asset.sizeBytes) > MAX_ZIP) return false;
  const bytes = await getObject(asset.storageKey, MAX_ZIP);
  if (!bytes) return false;
  try {
    return findManifest(readZip(bytes).map((e) => e.name)) !== null;
  } catch {
    return false;
  }
}

export async function unpackPackage(input: { organizationId: string; materialId: string; assetId: string }): Promise<UnpackResult> {
  const asset = await db.asset.findFirst({ where: { id: input.assetId, organizationId: input.organizationId }, select: { storageKey: true, sizeBytes: true, fileName: true } });
  if (!asset) throw new Error('ASSET_NOT_FOUND');
  if (Number(asset.sizeBytes) > MAX_ZIP) throw new Error('PACKAGE_TOO_LARGE');
  const bytes = await getObject(asset.storageKey, MAX_ZIP);
  if (!bytes) throw new Error('ASSET_UNREADABLE');

  const entries = readZip(bytes);
  const manifest = findManifest(entries.map((e) => e.name));
  if (!manifest) throw new Error('NO_MANIFEST');
  const xml = new TextDecoder().decode(entries.find((e) => e.name === manifest.path)!.read());
  const info = manifest.kind === 'xapi' ? parseTincan(xml) : parseImsManifest(xml);

  const existing = await db.scormPackage.findFirst({ where: { materialId: input.materialId, organizationId: input.organizationId }, select: { id: true } });
  const packageId = existing?.id ?? (await db.scormPackage.create({
    data: { organizationId: input.organizationId, materialId: input.materialId, assetId: input.assetId, title: info.title, standard: info.standard, identifier: info.identifier, launchPath: info.launchPath + launchQuery(info.launchPath), storagePrefix: '', masteryScore: info.masteryScore },
    select: { id: true },
  })).id;
  const prefix = `scorm/${input.organizationId}/${packageId}`;

  let fileCount = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    if (!e.name.startsWith(manifest.root)) continue;
    const rel = safeRelativePath(e.name.slice(manifest.root.length));
    if (!rel) continue;
    if (fileCount >= MAX_FILES) throw new Error('TOO_MANY_FILES');
    await putObject(`${prefix}/${rel}`, e.read(), inferMimeType(rel));
    fileCount += 1;
  }

  await db.scormPackage.update({
    where: { id: packageId },
    data: { assetId: input.assetId, title: info.title, standard: info.standard, identifier: info.identifier, launchPath: info.launchPath, storagePrefix: prefix, masteryScore: info.masteryScore, fileCount },
  });
  await db.material.update({ where: { id: input.materialId }, data: { type: 'SCORM' } });
  return { packageId, info, fileCount };
}
