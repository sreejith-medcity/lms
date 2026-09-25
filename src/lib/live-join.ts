import { meetFor, joinLinkFor } from '@/lib/medcity-meet';

/**
 * Where Join sends this person. For a Medcity Meet class that is a link made
 * for them now: learners go in by name with no second login, staff go in as
 * host. Every other class keeps its stored link.
 */
export async function joinTargetFor(
  organizationId: string,
  session: { id: string; provider: string; providerMeetingId: string | null; joinUrl: string | null },
  user: { id: string; name: string; email: string | null; kind: 'LEARNER' | 'STAFF' },
): Promise<{ url: string } | { error: string }> {
  if (session.provider !== 'MEET' || !session.providerMeetingId) {
    return session.joinUrl ? { url: session.joinUrl } : { error: 'The join link is not ready yet. Try again nearer the time.' };
  }
  const meet = await meetFor(organizationId);
  if (!meet) return { error: 'Medcity Meet is not connected for this academy any more. Tell the office.' };
  try {
    const url = await joinLinkFor(meet, session.id, { id: user.id, name: user.name, email: user.email, host: user.kind === 'STAFF' });
    return { url };
  } catch (err) {
    console.error('[meet] join link:', err instanceof Error ? err.message : err);
    return { error: 'The class room could not be opened just now. Try again in a moment.' };
  }
}
