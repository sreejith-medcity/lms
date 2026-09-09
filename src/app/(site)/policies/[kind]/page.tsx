import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';

export const dynamic = 'force-dynamic';

const KINDS = {
  privacy: { kind: 'PRIVACY', title: 'Privacy policy' },
  terms: { kind: 'TERMS', title: 'Terms of use' },
  refund: { kind: 'REFUND', title: 'Refunds and cancellation' },
  cookie: { kind: 'COOKIE', title: 'Cookies' },
  disclaimer: { kind: 'DISCLAIMER', title: 'Disclaimer' },
} as const;

type Slug = keyof typeof KINDS;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}): Promise<Metadata> {
  const slug = (await params).kind as Slug;
  const meta = KINDS[slug];
  if (!meta) return { title: 'Not found' };
  return { title: meta.title, alternates: { canonical: `/policies/${slug}` } };
}

/**
 * Policy text is legal text. It is shown only when someone has actually written
 * and published it; there is no placeholder wording that could be mistaken for
 * terms the academy has agreed to.
 */
export default async function PolicyPage({ params }: { params: Promise<{ kind: string }> }) {
  const slug = (await params).kind as Slug;
  const meta = KINDS[slug];
  if (!meta) notFound();

  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const policy = await db.policy.findUnique({
    where: { organizationId_kind: { organizationId: site.organizationId, kind: meta.kind } },
    select: { title: true, bodyHtml: true, updatedAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{policy?.title ?? meta.title}</h1>

      {policy ? (
        <>
          <p className="t-small faint mt-1">
            Last updated{' '}
            {policy.updatedAt.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
          <div
            className="prose prose-slate mt-6 max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: policy.bodyHtml }}
          />
        </>
      ) : (
        <div className="mt-6 rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-6">
          <p className="text-sm font-medium">Not published yet</p>
          <p className="t-small muted mt-1 max-w-prose">
            This policy has not been written and approved, and inventing legal text would be
            worse than saying so. Until it is published,{' '}
            <Link href="/contact" className="underline">
              ask us
            </Link>{' '}
            and we will tell you the position in writing.
          </p>
        </div>
      )}
    </div>
  );
}
