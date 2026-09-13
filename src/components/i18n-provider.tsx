'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { fill, type Locale } from '@/lib/i18n';

const Ctx = createContext<{ locale: Locale; dict: Record<string, string> }>({ locale: 'en', dict: {} });

/** Hands client components the dictionary the server chose, so they translate without a round trip. */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Record<string, string>; children: ReactNode }) {
  return <Ctx.Provider value={{ locale, dict }}>{children}</Ctx.Provider>;
}

export function useT() {
  const { dict, locale } = useContext(Ctx);
  return { locale, t: (text: string, vars?: Record<string, string | number>) => fill(dict[text] ?? text, vars) };
}
