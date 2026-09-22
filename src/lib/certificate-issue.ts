import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '@/lib/db';
import { buildObjectKey, getObject, putObject } from '@/lib/storage';
import { organizationOrigin } from '@/lib/org-origin';
import { readDesign, type CertificateDesign } from '@/lib/certificate';
import { renderCertificatePdf, type PdfPicture } from '@/lib/certificate-pdf';

/**
 * A certificate's PDF, made once and kept.
 *
 * Rendered on first request rather than at issue, so a template edit
 * reaches certificates already issued (the wording, not the serial), and
 * kept as an asset so the second request is a redirect rather than a
 * render. Editing the template or withdrawing the certificate clears the
 * kept copy, and the next request draws it again.
 */

export async function certificatePdfFor(certificateId: string, organizationId: string): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const cert = await db.issuedCertificate.findFirst({
    where: { id: certificateId, template: { organizationId } },
    select: {
      id: true,
      serialNo: true,
      issuedAt: true,
      revokedAt: true,
      verifyToken: true,
      pdfAssetId: true,
      user: { select: { name: true } },
      enrollment: { select: { product: { select: { title: true } } } },
      template: { select: { id: true, designJson: true, backgroundAssetId: true } },
    },
  });
  if (!cert) return null;
  const fileName = `${cert.serialNo}.pdf`;

  if (cert.pdfAssetId) {
    const kept = await db.asset.findFirst({ where: { id: cert.pdfAssetId, organizationId, deletedAt: null }, select: { storageKey: true } });
    const bytes = kept ? await getObject(kept.storageKey) : null;
    if (bytes) return { bytes, fileName };
  }

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true, brandColor: true, timezone: true } });
  if (!org) return null;
  const design = readDesign(cert.template.designJson);
  const origin = await organizationOrigin(organizationId);

  const pictures = await picturesForDesign(organizationId, design, cert.template.backgroundAssetId, org.logoUrl);

  const bytes = await renderCertificatePdf({
    design,
    values: {
      learner: cert.user.name,
      course: cert.enrollment?.product.title ?? '',
      academy: org.name,
      date: cert.issuedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: org.timezone }),
      serial: cert.serialNo,
    },
    verifyUrl: `${origin}/verify/${cert.verifyToken}`,
    accentHex: org.brandColor,
    ...pictures,
    revoked: Boolean(cert.revokedAt),
  });

  // Keep it. A failure here costs nothing but the next render.
  try {
    const key = buildObjectKey(organizationId, fileName);
    await putObject(key, bytes, 'application/pdf');
    const asset = await db.asset.create({
      data: { organizationId, name: `Certificate ${cert.serialNo}`, fileName, type: 'PDF', storageKey: key, mimeType: 'application/pdf', sizeBytes: BigInt(bytes.byteLength), transcodeStatus: 'READY' },
      select: { id: true },
    });
    await db.issuedCertificate.update({ where: { id: cert.id }, data: { pdfAssetId: asset.id } });
  } catch (err) {
    console.error('[certificates] could not keep the PDF', err instanceof Error ? err.message : err);
  }

  return { bytes, fileName };
}

/** Forget the kept PDFs of a template, after its design changed. */
export async function forgetCertificatePdfs(organizationId: string, where: { templateId?: string; certificateId?: string }): Promise<void> {
  await db.issuedCertificate.updateMany({
    where: {
      template: { organizationId },
      ...(where.templateId ? { templateId: where.templateId } : {}),
      ...(where.certificateId ? { id: where.certificateId } : {}),
    },
    data: { pdfAssetId: null },
  });
}

/** The three pictures a design may carry, fetched together. */
export async function picturesForDesign(
  organizationId: string,
  design: CertificateDesign,
  templateBackgroundId: string | null,
  logoUrl: string | null,
): Promise<{ background: PdfPicture | null; signature: PdfPicture | null; logo: PdfPicture | null }> {
  const [background, signature, logo] = await Promise.all([
    picture(organizationId, design.backgroundAssetId || templateBackgroundId),
    picture(organizationId, design.signatureAssetId),
    design.showLogo ? logoPicture(organizationId, logoUrl) : Promise.resolve(null),
  ]);
  return { background, signature, logo };
}

async function picture(organizationId: string, assetId: string | null | undefined): Promise<PdfPicture | null> {
  if (!assetId) return null;
  const asset = await db.asset.findFirst({ where: { id: assetId, organizationId, deletedAt: null }, select: { storageKey: true, mimeType: true } });
  if (!asset) return null;
  const bytes = await getObject(asset.storageKey, 12 * 1024 * 1024);
  return bytes ? { bytes, mimeType: asset.mimeType } : null;
}

/** The academy's mark: an uploaded asset, or the bundled artwork. */
export async function logoPicture(organizationId: string, logoUrl: string | null): Promise<PdfPicture | null> {
  if (!logoUrl) return null;
  const m = /^\/api\/assets\/([A-Za-z0-9_-]+)/.exec(logoUrl);
  if (m) return picture(organizationId, m[1]);
  if (logoUrl.startsWith('/brand/')) {
    try {
      const file = logoUrl === '/brand/logo.png' ? '/brand/mark.png' : logoUrl;
      const bytes = await readFile(join(process.cwd(), 'public', file));
      return { bytes: new Uint8Array(bytes), mimeType: 'image/png' };
    } catch {
      return null;
    }
  }
  return null;
}
