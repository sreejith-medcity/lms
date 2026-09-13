import { inflateRawSync } from 'node:zlib';

/**
 * A zip reader with no dependency: the central directory is walked from the
 * end of the file and each entry inflated on request. Stored and deflated
 * entries, which is every SCORM package ever built; no zip64, no encryption.
 */

export interface ZipEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  read: () => Uint8Array;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB (comment length).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_558); i -= 1) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('NOT_A_ZIP');
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  let p = dirOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error('BAD_CENTRAL_DIRECTORY');
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    const isDirectory = name.endsWith('/');
    entries.push({
      name,
      size,
      isDirectory,
      read: () => {
        if (isDirectory) return new Uint8Array(0);
        if (view.getUint32(localOffset, true) !== LOCAL) throw new Error('BAD_LOCAL_HEADER');
        const lNameLen = view.getUint16(localOffset + 26, true);
        const lExtraLen = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) return new Uint8Array(data);
        if (method === 8) return new Uint8Array(inflateRawSync(data));
        throw new Error(`UNSUPPORTED_COMPRESSION_${method}`);
      },
    });
  }
  return entries;
}
