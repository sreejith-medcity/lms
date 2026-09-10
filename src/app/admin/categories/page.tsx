import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { CategoryList, NewCategoryForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function CategoriesPage() {
  const tenant = await requireTenant();
  await requireStaff('category.manage_categories', 'view');

  const [categories, courses] = await Promise.all([
    db.category.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        isActive: true,
        tagline: true,
        imageAssetId: true,
        ctaLabel: true,
        comingSoon: true,
        showOnHome: true,
        sortOrder: true,
        _count: { select: { courses: true, children: true } },
      },
    }),
    db.course.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { product: { title: 'asc' } },
      select: {
        id: true,
        product: { select: { title: true, status: true } },
        categories: { select: { categoryId: true } },
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Categories"
        description="How the public site is organised. Each one is a page at /courses/its-name, and a category with nothing published behind it is hidden rather than shown as a dead end."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {categories.length === 0 ? (
            <EmptyState title="No categories yet" hint="Language, Nursing, Healthcare, and so on." />
          ) : (
            <CategoryList
              categories={categories}
              courses={courses.map((c) => ({
                id: c.id,
                title: c.product.title,
                published: c.product.status === 'PUBLISHED',
                categoryIds: c.categories.map((cc) => cc.categoryId),
              }))}
            />
          )}
        </div>

        <Card>
          <h2 className="t-heading">New category</h2>
          <p className="t-small muted mt-1">
            The name sets the public address. Renaming one later changes that URL, so it is worth
            getting right now.
          </p>
          <div className="mt-5">
            <NewCategoryForm
              parents={categories.filter((c) => !c.parentId).map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
