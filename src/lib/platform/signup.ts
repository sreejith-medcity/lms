/**
 * Self-serve signup: the rules a new academy's request must pass before
 * anything is written. No database here, so they can be tested alone.
 */

/** Subdomains that would collide with the platform or mislead. */
export const RESERVED_SLUGS = new Set([
  'www', 'admin', 'platform', 'api', 'app', 'mail', 'smtp', 'imap', 'ftp', 'cdn', 'static', 'assets', 'media', 'help', 'support', 'status', 'billing', 'docs', 'blog', 'login', 'signup', 'start', 'demo', 'test', 'staging', 'dev', 'localhost', 'medcity',
]);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

export function slugProblem(slug: string): string | null {
  if (!slug) return 'Pick a web address for the academy.';
  if (slug.length < 3) return 'The address needs at least three characters.';
  if (slug.length > 40) return 'Keep the address under forty characters.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return 'Letters, digits and hyphens only, starting and ending with a letter or digit.';
  if (RESERVED_SLUGS.has(slug)) return 'That address is reserved. Try another.';
  return null;
}

export interface SignupInput {
  academyName: string;
  slug: string;
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  planCode: string;
  /** The honeypot: a field no person fills. */
  website?: string;
}

export function signupProblem(input: SignupInput): string | null {
  if (input.website && input.website.trim()) return 'Something went wrong. Please try again.';
  if (input.academyName.trim().length < 2) return 'Give the academy a name.';
  if (input.academyName.trim().length > 120) return 'Keep the academy name under 120 characters.';
  const slug = slugProblem(input.slug);
  if (slug) return slug;
  if (input.ownerName.trim().length < 2) return 'Tell us your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'That does not look like an email address.';
  const digits = input.phone.replace(/\D/g, '');
  if (digits.length < 10) return 'A mobile number with at least ten digits, please.';
  if (input.password.length < 8) return 'A password of at least eight characters.';
  if (!input.planCode) return 'Pick a plan to start on.';
  return null;
}

/** "Medcity International Academy" → "medcity-international-academy", or "academy" when nothing survives. */
export function suggestSlug(name: string): string {
  const s = slugify(name);
  return s && !RESERVED_SLUGS.has(s) ? s : 'academy';
}

export function trialEnd(from: Date, trialDays: number): Date {
  return new Date(from.getTime() + Math.max(0, trialDays) * 864e5);
}
