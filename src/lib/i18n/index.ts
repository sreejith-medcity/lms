import { CATALOGUE } from './catalogue';

/**
 * The learner side in the learner's language.
 *
 * English is the source text and the key: a screen says `t('My learning')`
 * and the catalogue supplies the Malayalam or Hindi. A string with no entry
 * falls back to English rather than to a blank or a key, so a screen is
 * never worse for being partly translated. Variables are `{{name}}`.
 */

export const LOCALES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LANG_COOKIE = 'mlms_lang';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some((l) => l.code === value);
}

/** The languages the academy offers, from the setting's comma list; English is always in. */
export function offeredLocales(setting: string | null | undefined): Locale[] {
  const wanted = String(setting ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(isLocale);
  const out: Locale[] = ['en'];
  for (const code of wanted) if (!out.includes(code)) out.push(code);
  return out;
}

/** The locale to use: what the person chose if the academy offers it, else the default. */
export function pickLocale(preferred: unknown, offered: Locale[]): Locale {
  return isLocale(preferred) && offered.includes(preferred) ? preferred : DEFAULT_LOCALE;
}

export function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  const dict = locale === 'en' ? null : CATALOGUE[locale];
  return fill(dict?.[text] ?? text, vars);
}

export type Translator = (text: string, vars?: Record<string, string | number>) => string;

export function translatorFor(locale: Locale): Translator {
  return (text, vars) => translate(locale, text, vars);
}

/** The dictionary a client component needs, so it can translate without a round trip. */
export function dictionaryFor(locale: Locale): Record<string, string> {
  return locale === 'en' ? {} : CATALOGUE[locale];
}

/** The BCP 47 tag for dates and numbers in this locale. */
export function intlTag(locale: Locale): string {
  return locale === 'ml' ? 'ml-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN';
}
