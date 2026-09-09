import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border bg-white p-5 ${className}`}>{children}</div>;
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
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`${buttonClass(variant)} ${className}`} />;
}

export function LinkButton({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <Link {...props} className={`${buttonClass(variant)} ${className}`} />;
}

function buttonClass(variant: 'primary' | 'secondary' | 'danger') {
  const base =
    'inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-60';
  if (variant === 'secondary') return `${base} border bg-white text-slate-700 hover:bg-slate-50`;
  if (variant === 'danger') return `${base} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
  return `${base} text-white`;
}

export const brandStyle = { background: 'var(--brand)' } as const;

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
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const control =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`${control} ${className}`} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`${control} ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`${control} ${className}`} />;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-white p-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
