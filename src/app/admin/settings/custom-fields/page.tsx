import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { FIELD_ENTITIES, optionsOf } from '@/lib/custom-fields';
import { PageHeader } from '@/components/ui';
import { FieldsBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const { entity } = await searchParams;
  const tenant = await requireTenant();
  const me = await requireStaff('settings.custom_fields', 'view');
  const canEdit = me.permissions['settings.custom_fields']?.edit ?? false;

  const current =
    FIELD_ENTITIES.find((e) => e.value === entity)?.value ?? FIELD_ENTITIES[0].value;

  const [fields, counts] = await Promise.all([
    db.customFieldDefinition.findMany({
      where: { organizationId: tenant.organizationId, entity: current },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        label: true,
        type: true,
        options: true,
        showOnSignup: true,
        signupTiming: true,
        signupRequired: true,
        showOnOfflineForm: true,
        offlineRequired: true,
        isActive: true,
        _count: { select: { values: true } },
      },
    }),
    db.customFieldDefinition.groupBy({
      by: ['entity'],
      where: { organizationId: tenant.organizationId },
      _count: true,
    }),
  ]);

  const countBy = new Map(counts.map((c) => [c.entity, c._count]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom fields"
        description="Anything you need to know about a learner, a batch or a course that this product does not already ask for."
      />

      <FieldsBoard
        canEdit={canEdit}
        entity={current}
        entities={FIELD_ENTITIES.map((e) => ({ ...e, count: countBy.get(e.value) ?? 0 }))}
        fields={fields.map((f, i) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          options: optionsOf(f.options).join(', '),
          showOnSignup: f.showOnSignup,
          signupTiming: f.signupTiming,
          signupRequired: f.signupRequired,
          showOnOfflineForm: f.showOnOfflineForm,
          offlineRequired: f.offlineRequired,
          isActive: f.isActive,
          answers: f._count.values,
          canMoveUp: i > 0,
          canMoveDown: i < fields.length - 1,
        }))}
      />
    </div>
  );
}
