/**
 * A language, as a buyer should read it.
 *
 * The field behind this is free text, because an academy might teach
 * "Malayalam and English" or "German, with Malayalam support" and no code list
 * covers that. But free text invites a code: somebody typed `de`, and the
 * course page then advertised a German course as being taught in "de".
 *
 * So anything that looks like a language code becomes the language's name, and
 * anything else is printed exactly as it was typed. The academy keeps the
 * freedom; the buyer stops seeing an abbreviation.
 */

const NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ur: 'Urdu',
  sa: 'Sanskrit',
  ne: 'Nepali',
  si: 'Sinhala',
};

export function languageName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const value = raw.trim();
  if (!value) return null;

  // Only a bare code is translated. "de" becomes German; "German A1" and
  // "Malayalam and English" are somebody's own wording and are left alone.
  const code = value.toLowerCase().replace('_', '-').split('-')[0];
  if (value.length <= 5 && NAMES[code]) return NAMES[code];

  return value;
}
