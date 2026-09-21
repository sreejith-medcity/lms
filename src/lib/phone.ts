/**
 * A mobile as typed on the sign-up form, in the shape the product keeps:
 * ten digits for India (a leading 0 or 91 dropped), or a plus and the
 * digits for anywhere else. Null when it is not a mobile number at all.
 */
export function signupPhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, '');
  const international = /^(\+|00)/.test(trimmed);
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
  if (international) {
    if (digits.startsWith('91') && digits.length === 12) return /^[6-9]/.test(digits.slice(2)) ? digits.slice(2) : null;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const ten = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return ten.length === 10 && /^[6-9]/.test(ten) ? ten : null;
}

