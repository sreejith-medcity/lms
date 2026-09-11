import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { describeRemaining, shareVerdict } from '@/lib/recording-share';
import { MaterialViewer } from '@/components/material-viewer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shared recording', robots: { index: false, follow: false } };

/**
 * A class recording, shared with one learner until a date.
 *
 * The link is not the key. It finds the share; the account watching decides
 * whether it plays, so forwarding it achieves nothing. Every refusal says
 * which of the reasons it was, because "this does not work" sends the
 * candidate to the office and the office to us.
 */
export default async function SharedRecording({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();

  const share = await db.recordingShare.findFirst({
    where: { token, organizationId: tenant.organizationId },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      maxViews: true,
      viewCount: true,
      revokedAt: true,
      createdAt: true,
      note: true,
      recording: {
        select: {
          id: true,
          title: true,
          assetId: true,
          asset: { select: { type: true } },
          session: {
            select: {
              title: true,
              startsAt: true,
              batch: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!share) notFound();

  const verdict = shareVerdict(share, user?.id ?? null);

  if (!verdict.ok) {
    // Signing in is the one refusal that is not final, so it is a door
    // rather than a message.
    if (verdict.reason === 'SIGN_IN') {
      redirect(`/login?next=${encodeURIComponent(`/learn/shared/${token}`)}`);
    }

    return (
      <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="t-title">{share.recording.title}</h1>
        <p className="muted mt-3">{verdict.message}</p>
        <Link href="/learn" className="t-small mt-6 inline-block underline">
          Go to my learning
        </Link>
      </main>
    );
  }

  // Counted here rather than when the video starts, because a page opened is
  // what the office is asked about, and a video that is never pressed still
  // means the link worked.
  await db.recordingShare.update({
    where: { id: share.id },
    data: {
      viewCount: { increment: 1 },
      lastViewedAt: new Date(),
      ...(share.viewCount === 0 ? { firstViewedAt: new Date() } : {}),
    },
  });

  const when = share.recording.session.startsAt;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
        Shared with you
      </p>
      <h1 className="t-title mt-1.5">{share.recording.title}</h1>
      <p className="t-small muted mt-1">
        {share.recording.session.title}
        {share.recording.session.batch ? ` · ${share.recording.session.batch.name}` : ''} ·{' '}
        {formatDayLabel(dayKey(when, tenant.timezone), tenant.timezone)},{' '}
        {formatTime(when, tenant.timezone)}
      </p>

      {share.note && <p className="t-body mt-4">{share.note}</p>}

      <div className="mt-6">
        <MaterialViewer
          type={share.recording.asset.type}
          title={share.recording.title}
          assetId={share.recording.assetId}
          isDownloadable={false}
          externalUrl={null}
          bodyHtml={null}
        />
      </div>

      <p className="t-small faint mt-4">
        This link is yours alone and has {describeRemaining(share.expiresAt)}.
        {verdict.viewsLeft != null
          ? ` You may open it ${verdict.viewsLeft} more time${verdict.viewsLeft === 1 ? '' : 's'}.`
          : ''}
      </p>
    </main>
  );
}
