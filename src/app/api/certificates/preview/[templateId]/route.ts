import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { readDesign } from '@/lib/certificate';
import { renderCertificatePdf } from '@/lib/certificate-pdf';
import { picturesForDesign } from '@/lib/certificate-issue';

export const dynamic = 'force-dynamic';

/** A sample PDF from a template as it stands, for the designer's "as it will print" link. */
export async function GET(_req: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  try {
    await requireStaff('certificates.manage_templates', 'view');
  } catch {
    return new NextResponse('Sign in', { status: 401 });
  }
  const [template, org] = await Promise.all([
    db.certificateTemplate.findFirst({ where: { id: templateId, organizationId: tenant.organizationId }, select: { designJson: true, serialPrefix: true, backgroundAssetId: true } }),
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, logoUrl: true, brandColor: true } }),
  ]);
  if (!template || !org) return new NextResponse('Not found', { status: 404 });
  const design = readDesign(template.designJson);
  const pictures = await picturesForDesign(tenant.organizationId, design, template.backgroundAssetId, org.logoUrl);
  const bytes = await renderCertificatePdf({
    design,
    values: { learner: 'Aparna Menon', course: 'German Language - A1', academy: org.name, date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), serial: `${template.serialPrefix}-00001` },
    verifyUrl: 'https://example.invalid/verify/sample',
    accentHex: org.brandColor,
    ...pictures,
  });
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="sample.pdf"', 'cache-control': 'no-store' } });
}
