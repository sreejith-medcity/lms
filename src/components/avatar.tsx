/** A person's picture, or their initial on the brand colour when there is none. */
export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-bold text-[var(--brand-ink)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: 'var(--brand)' }}
    >
      {initial}
    </span>
  );
}
