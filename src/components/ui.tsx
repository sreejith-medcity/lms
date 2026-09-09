import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/* Layout ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius)] border bg-[var(--surface)] shadow-sm ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="t-title">{title}</h1>
        {description && <p className="t-small muted mt-1 max-w-prose">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* Actions ----------------------------------------------------------------- */

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--brand)] text-[var(--brand-ink)] hover:brightness-110',
  /* The amber. Reserved for the one action a page exists for, because a screen
     where three things are the accent has none. */
  accent: 'bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-105',
  secondary: 'border bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]',
  ghost: 'text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
  danger: 'border border-[var(--bad)]/30 bg-[var(--surface)] text-[var(--bad)] hover:bg-[var(--bad-soft)]',
};

const sizes = {
  sm: 'h-8 px-2.5 text-[0.8125rem]',
  md: 'h-10 px-3.5 text-sm',
  lg: 'h-11 px-5 text-sm',
} as const;

function base(variant: Variant, size: keyof typeof sizes) {
  return `inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition
    disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${sizes[size]}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button {...props} className={`${base(variant, size)} ${className}`} />;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link {...props} className={`${base(variant, size)} ${className}`} />;
}

/** Kept for older call sites that pass an inline brand background. */
export const brandStyle = {} as const;

/* Forms ------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-small block font-medium">{label}</span>
      {hint && <span className="t-small faint mt-0.5 block">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="t-small mt-1 block text-[var(--bad)]">{error}</span>}
    </label>
  );
}

const control = `w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm
  text-[var(--ink)] placeholder:text-[var(--ink-3)] transition
  focus:border-[var(--brand)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-soft)]`;

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`${control} ${className}`} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`${control} ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`${control} ${className}`} />;
}

export function Checkbox({
  label,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  return (
    <label className="flex gap-3">
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
      />
      <span>
        <span className="t-small block">{label}</span>
        {hint && <span className="t-small faint block">{hint}</span>}
      </span>
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="t-small rounded-[var(--radius-sm)] border border-[var(--bad)]/25 bg-[var(--bad-soft)] px-3 py-2 text-[var(--bad)]"
    >
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="t-small rounded-[var(--radius-sm)] bg-[var(--ok-soft)] px-3 py-2 text-[var(--ok)]">
      {message}
    </p>
  );
}

/* Indicators -------------------------------------------------------------- */

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad';

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--ink-2)]',
  brand: 'bg-[var(--brand-soft)] text-[var(--brand)]',
  ok: 'bg-[var(--ok-soft)] text-[var(--ok)]',
  warn: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  bad: 'bg-[var(--bad-soft)] text-[var(--bad)]',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Progress as a ring rather than a bar: readable at a glance in a dense list. */
export function ProgressRing({ value, size = 40 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = size >= 40 ? 4 : 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * clamped) / 100}
          style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(0.2,0.8,0.2,1)' }}
        />
      </svg>
      <span className="absolute text-[0.625rem] font-semibold tabular-nums">{clamped}</span>
      <span className="sr-only">{clamped}% complete</span>
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full bg-[var(--brand)]"
        style={{ width: `${clamped}%`, transition: 'width 500ms cubic-bezier(0.2,0.8,0.2,1)' }}
      />
    </div>
  );
}

/* Empty and loading ------------------------------------------------------- */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-10 text-center">
      <p className="t-heading">{title}</p>
      {hint && <p className="t-small muted mx-auto mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-[var(--radius-sm)] ${className}`} />;
}

/* Data -------------------------------------------------------------------- */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border bg-[var(--surface)] shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-[var(--surface-2)]">
            {head.map((h, i) => (
              <th key={i} className="t-micro faint px-4 py-2.5 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b last:border-0 hover:bg-[var(--surface-2)]">{children}</tr>;
}

export function Cell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
