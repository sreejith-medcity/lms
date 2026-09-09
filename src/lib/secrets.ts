import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secrets, sealed before they touch the database.
 *
 * A settings screen that lets somebody paste an API key is a liability if that
 * key is then stored in plain text: a database dump, a support export or a
 * misdirected backup hands over live payment credentials. So every secret is
 * encrypted with AES-256-GCM under a key derived from AUTH_SECRET, and the
 * authentication tag means a tampered value fails to open rather than
 * decrypting to something wrong.
 *
 * Rotating AUTH_SECRET makes every stored secret unreadable. That is the
 * correct behaviour: the alternative is a key that is never rotated because
 * rotating it is inconvenient.
 */

const VERSION = 'v1';

function key(): Buffer {
  const source = process.env.AUTH_SECRET || 'insecure-development-secret';
  return createHash('sha256').update(`secrets:${source}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(
    '.',
  );
}

export function open(sealed: string): string | null {
  try {
    const [version, iv, tag, payload] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !payload) return null;

    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // A secret that will not open is a secret that has to be entered again.
    return null;
  }
}

/**
 * What a secret looks like on screen.
 *
 * Never the value. Enough to recognise which key is in there — the last four
 * characters are how somebody checks they pasted the live key rather than the
 * test one — and nothing an onlooker could use.
 */
export function mask(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}
