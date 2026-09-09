import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { Badge } from '@/components/ui';
import { PublishToggle } from './publish-toggle';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '', label: 'Details' },
  { href: '/curriculum', label: 'Curriculum' },
  { href: '/pricing', label: 'Pricing and publishing' },
];

export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: { id: true, title: true, status: true },
  });
  if (!product) notFound();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/courses" className="text-sm text-slate-500 hover:underline">
            Courses
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl font-semibold">{product.title}</h1>
          <Badge tone={product.status === 'PUBLISHED' ? 'green' : 'amber'}>{product.status}</Badge>
        </div>
        <PublishToggle productId={product.id} published={product.status === 'PUBLISHED'} />
      </div>

      <nav className="mb-6 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={`/admin/courses/${product.id}${t.href}`}
            className="border-b-2 border-transparent px-3 pb-2 text-slate-600 hover:border-slate-300 hover:text-slate-900"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
