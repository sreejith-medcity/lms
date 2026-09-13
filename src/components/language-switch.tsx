'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLanguage } from '@/server/language';
import { LOCALES, type Locale } from '@/lib/i18n';

/** The language menu. Only the languages the academy offers; hidden when that is English alone. */
export function LanguageSwitch({ current, offered, compact = false }: { current: Locale; offered: Locale[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (offered.length < 2) return null;
  const choices = LOCALES.filter((l) => offered.includes(l.code));
  return (
    <label className={`inline-flex items-center gap-2 ${compact ? '' : 't-small'}`}>
      <span className="sr-only">Language</span>
      <select
        aria-label="Language"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const code = e.target.value;
          start(async () => {
            await setLanguage(code);
            router.refresh();
          });
        }}
        className={`rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 py-1 text-sm ${compact ? 'h-8' : ''}`}
      >
        {choices.map((l) => (
          <option key={l.code} value={l.code}>{l.native}</option>
        ))}
      </select>
    </label>
  );
}
