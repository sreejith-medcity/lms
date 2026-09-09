import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Two-factor, RFC 6238, written here rather than pulled in.
 *
 * It is a HMAC, a truncation and a division. A dependency for that would be
 * more code to audit than the algorithm, and this deployment already prefers
 * node:crypto over native modules for the same reason scrypt was chosen over
 * argon2.
 *
 * The window is one step either side. Phones drift, and a person typing a code
 * as it rolls over should not be told they are wrong; three steps is thirty
 * seconds of extra guessing surface and not worth it.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20): string {
  const buffer = randomBytes(bytes);
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');

  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function decodeBase32(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function at(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentCode(secret: string): string {
  return at(secret, Math.floor(Date.now() / 1000 / STEP_SECONDS));
}

export function verifyCode(secret: string, code: string): boolean {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return false;

  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const supplied = Buffer.from(cleaned);

  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    const expected = Buffer.from(at(secret, counter + drift));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

/**
 * The URI a phone camera turns into an entry in Google Authenticator. The label
 * carries the academy name so somebody with three institutes in their app can
 * tell them apart.
 */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes, for the phone that goes in the sea.
 *
 * Stored hashed alongside the secret, single use, and shown exactly once. An
 * academy without these ends up with an admin locked out of their own product
 * and a support request nobody can safely act on.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = () => String(randomInt(0, 100_000)).padStart(5, '0');
    codes.push(`${part()}-${part()}`);
  }
  return codes;
}
