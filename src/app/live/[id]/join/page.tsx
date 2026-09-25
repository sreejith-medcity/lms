import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { joinSession } from '@/server/sessions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Joining class', robots: { index: false, follow: false } };

/**
 * The link stored on a Medcity Meet class. Opening it takes attendance the
 * way the Join button does and sends this person into the room with a link
 * made for them, so a forwarded copy of this address signs nobody else in.
 */
export default async function JoinLive({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/live/${id}/join`)}`);

  const result = await joinSession(id);
  if (result.ok && result.url) redirect(result.url);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">Could not open the class</h1>
      <p className="text-sm text-[var(--ink-2)]">{result.error ?? 'Please try again in a moment.'}</p>
      <Link href={user.kind === 'STAFF' ? '/admin' : '/learn'} className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm">
        Back
      </Link>
    </main>
  );
}
