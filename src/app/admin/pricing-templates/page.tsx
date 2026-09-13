import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { describeTemplate } from '@/lib/pricing-templates';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { TemplateActions, TemplateForm, type TemplateDraft } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Pricing templates: the shapes a price comes in.
 *
 * An academy with forty courses does not have forty ways of being paid;
 * it has three or four. Naming them here means a plan is added by picking
 * a shape and typing a number, and every "standard" plan is actually
 * standard.
 */
export default async function PricingTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.pricing_and_publish', 'view');
  const canEdit = me.permissions['courses.pricing_and_publish']?.edit ?? false;
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : '';

  const templates = await db.pricingTemplate.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true, name: true, planType: true, instalmentCount: true, gapDays: true, shares: true, validityDays: true, invoiceAnchor: true, notes: true, isActive: true, _count: { select: { plans: true } } },
  });

  const editing = templates.find((t) => t.id === editId);
  const draft: TemplateDraft | null = editing ? { ...editing, notes: editing.notes ?? '' } : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing templates"
        description="The shapes a price comes in: how it is paid, in how many parts, how far apart, how long access lasts. Pick one when adding a plan to a course and the fields fill themselves."
        action={
          <Link href="/admin/courses" className="t-small muted hover:underline">
            Courses
          </Link>
        }
      />

      {canEdit && (
        <Card>
          <h2 className="t-heading">{draft ? `Editing: ${draft.name}` : 'Add a template'}</h2>
          <div className="mt-4">
            <TemplateForm key={draft?.id ?? 'new'} draft={draft} />
          </div>
        </Card>
      )}

      {templates.length === 0 ? (
        <EmptyState title="No templates yet" hint="Add the shapes you use most: a standard three-part plan, paid in full with a year's access." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} className={t.isActive ? '' : 'opacity-70'}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{t.name}</p>
                <Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'In use' : 'Retired'}</Badge>
              </div>
              <p className="t-small mt-2">{describeTemplate(t)}</p>
              {t.notes && <p className="t-small muted mt-1">{t.notes}</p>}
              <p className="t-micro faint mt-2">{t._count.plans === 0 ? 'No plans made from it yet.' : `${t._count.plans} plan${t._count.plans === 1 ? '' : 's'} made from it.`}</p>
              {canEdit && (
                <div className="mt-3">
                  <TemplateActions id={t.id} isActive={t.isActive} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
