import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { readDesign } from '@/lib/certificate';
import { Certificate } from '@/components/certificate';
import { Badge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  robots: { index: false, follow: false },
};

/**
 * The public check.
 *
 * An employer with nothing but the code on a piece of paper can settle whether
 * it is real, without an account and without asking anyone. It shows the holder,
 * the course and the date, and nothing else about them: verifying a certificate
 * is not a reason to hand over a learner's contact details.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const site = await getSiteContext();

  const cert = await db.issuedCertificate.findFirst({
    where: { verifyToken: token },
    select: {
      serialNo: true,
      issuedAt: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { name: true, organizationId: true } },
      enrollment: { select: { product: { select: { title: true } } } },
      template: { select: { designJson: true, organizationId: true } },
    },
  });

  // Scoped to this academy's own hostname, so one tenant's page cannot be used
  // to confirm another's certificates.
  const valid = cert && site && cert.template.organizationId === site.organizationId;

  if (!valid) {
    return (
      <Shell>
        <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-8 text-center">
          <p className="t-heading">No certificate with that code</p>
          <p className="t-small muted mx-auto mt-2 max-w-sm">
            Check the code on the certificate. If it still does not come up, the certificate was
            not issued here.
          </p>
        </div>
      </Shell>
    );
  }

  const design = readDesign(cert.template.designJson);
  const expired = cert.expiresAt != null && cert.expiresAt < new Date();
  const status = cert.revokedAt ? 'revoked' : expired ? 'expired' : 'valid';

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-title">Certificate {cert.serialNo}</h1>
          <p className="t-small faint mt-1">
            Issued by {site.organization.name} on{' '}
            {cert.issuedAt.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <Badge tone={status === 'valid' ? 'ok' : status === 'expired' ? 'warn' : 'bad'}>
          {status === 'valid' ? 'Valid' : status === 'expired' ? 'Expired' : 'Withdrawn'}
        </Badge>
      </div>

      {status !== 'valid' && (
        <p className="t-small mb-5 rounded-[var(--radius-sm)] border border-dashed p-3">
          {cert.revokedAt
            ? `This certificate was withdrawn by the academy on ${cert.revokedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. It should not be relied on.`
            : `This certificate expired on ${cert.expiresAt?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`}
        </p>
      )}

      <div className="overflow-hidden rounded-[var(--radius)] border shadow-sm">
        <Certificate
          design={design}
          revoked={Boolean(cert.revokedAt)}
          values={{
            learner: cert.user.name,
            course: cert.enrollment?.product.title ?? '',
            academy: site.organization.name,
            date: cert.issuedAt.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
            serial: cert.serialNo,
          }}
        />
      </div>

      <p className="t-small faint mt-5">
        This page is the record. It shows the holder, the course and the date, and nothing else
        about them.{' '}
        <Link href="/" className="underline">
          {site.organization.name}
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl px-5 py-12">{children}</main>;
}
