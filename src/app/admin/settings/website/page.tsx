import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { settingText } from '@/lib/settings/store';
import { SocialForm, PolicyEditor } from './forms';
import { HeroImageForm } from './hero-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const POLICIES = [
  { kind: 'PRIVACY', title: 'Privacy policy', why: 'Required wherever you collect a name and an email, which is everywhere.' },
  { kind: 'TERMS', title: 'Terms of service', why: 'What somebody agrees to when they enrol.' },
  { kind: 'REFUND', title: 'Refund policy', why: 'The one a payment gateway asks to see, and the one arguments are settled by.' },
  { kind: 'COOKIE', title: 'Cookie policy', why: 'Needed once analytics or ads are on the storefront.' },
  { kind: 'DISCLAIMER', title: 'Disclaimer', why: 'Outcome claims, exam results, anything a learner might read as a promise.' },
];

export default async function WebsiteSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.organization', 'view');
  const canEdit = me.permissions['settings.organization']?.edit ?? false;

  const [org, policies] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { social: true },
    }),
    db.policy.findMany({
      where: { organizationId: tenant.organizationId },
      select: { kind: true, title: true, bodyHtml: true, updatedAt: true },
    }),
  ]);

  const heroImage = await settingText(tenant.organizationId, 'website.heroImageAssetId');
  const social = (org.social ?? {}) as Record<string, string>;
  const byKind = new Map(policies.map((p) => [p.kind as string, p]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website"
        description="What the public side says about you, beyond the courses themselves."
      />

      <Card>
        <h2 className="t-heading">The home page photograph</h2>
        <p className="t-small muted mt-1 max-w-prose">
          The words around it, and your Google rating, are on the Preferences screen under
          &ldquo;The public site&rdquo;.
        </p>
        <div className="mt-4">
          <HeroImageForm assetId={heroImage} canEdit={canEdit} />
        </div>
      </Card>

      <Card>
        <h2 className="t-heading">Where else you are</h2>
        <p className="t-small muted mt-1 max-w-prose">
          Shown in the site footer. Leave one blank and it simply does not appear, rather than
          linking somewhere broken.
        </p>
        <div className="mt-4">
          <SocialForm social={social} canEdit={canEdit} />
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="t-heading">Policies</h2>
        <p className="t-small muted max-w-prose">
          Each one gets its own page and a footer link. Written here rather than as ordinary
          storefront pages, because a refund policy is a commitment rather than copy, and it should
          be hard to delete by accident.
        </p>

        {POLICIES.map((p) => {
          const existing = byKind.get(p.kind);
          return (
            <PolicyEditor
              key={p.kind}
              canEdit={canEdit}
              kind={p.kind}
              heading={p.title}
              why={p.why}
              title={existing?.title ?? p.title}
              bodyHtml={existing?.bodyHtml ?? ''}
              updatedAt={existing ? existing.updatedAt.toISOString() : null}
            />
          );
        })}
      </section>
    </div>
  );
}
