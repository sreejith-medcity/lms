/**
 * What a buyer has to tell us before they can pay without an account.
 *
 * Three fields, and each one earns its place: a name because an invoice needs
 * one, an email because that is where the invoice goes and what the account is
 * keyed on, and a mobile number because in this market that is how the academy
 * actually reaches a student, and because it is the second way back into an
 * account when the email address turns out to be a typo.
 *
 * Kept apart from the database on purpose, so the rules can be tested. Every
 * message here is shown to somebody with a card in their hand, so each one
 * says what to do rather than what went wrong.
 */

export interface GuestContact {
  name?: string;
  email?: string;
  phone?: string;
}

export type NormalisedContact =
  | { ok: true; name: string; email: string; phone: string }
  | { ok: false; error: string };

/** Deliberately permissive. An address is proved by using it, not by a regex. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Indian mobile numbers, however they were typed.
 *
 * +91, 0091, a leading zero, spaces and dashes all arrive in practice, and a
 * checkout that rejects "+91 98470 12345" loses a sale to punctuation.
 */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return null;
  if (!/^[6-9]/.test(local)) return null;
  return local;
}

export function normaliseContact(input: GuestContact | undefined): NormalisedContact {
  const name = (input?.name ?? '').trim().replace(/\s+/g, ' ');
  const email = (input?.email ?? '').trim().toLowerCase();
  const phoneRaw = (input?.phone ?? '').trim();

  if (name.length < 2) return { ok: false, error: 'Please tell us your name.' };
  if (name.length > 120) return { ok: false, error: 'That name is too long for an invoice.' };
  if (!EMAIL.test(email)) return { ok: false, error: 'Please give an email we can send the invoice to.' };
  if (email.length > 190) return { ok: false, error: 'That email address is too long.' };

  const phone = normaliseIndianMobile(phoneRaw);
  if (!phone) return { ok: false, error: 'Please give a 10 digit mobile number.' };

  return { ok: true, name, email, phone };
}
