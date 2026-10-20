import { db } from '@/lib/db';
import { curriculumGate } from '@/lib/curriculum-access';
import { MATERIAL_LABELS } from '@/lib/progress';
import { readUrlFor } from '@/lib/storage';
import { licenceUntil, offlineVerdict, OFFLINE_LICENCE_DAYS, sizeLabel, type OfflineVerdict } from '@/lib/offline';
import type { TenantContext } from '@/lib/tenant';
import type { ApiUser } from './auth';

/**
 * The lessons of one course the learner may download, with links to fetch
 * them (signed for half an hour, minted only after the enrolment, drip and
 * visibility checks the lesson page makes) and the date the phone has to
 * check in again by. Calling it again is how the phone renews what it has.
 */
export async function courseDownloads(tenant: TenantContext, user: ApiUser, productId: string, now = new Date()) {
  const enrollment = await db.enrollment.findFirst({
    where: { organizationId: tenant.organizationId, userId: user.id, productId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      batchId: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          title: true,
          course: {
            select: {
              id: true,
              modules: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  module: {
                    select: {
                      id: true,
                      name: true,
                      sections: {
                        where: { isVisible: true },
                        orderBy: { sortOrder: 'asc' },
                        select: {
                          id: true,
                          title: true,
                          materials: {
                            orderBy: { sortOrder: 'asc' },
                            select: {
                              id: true,
                              title: true,
                              type: true,
                              durationSeconds: true,
                              isDownloadable: true,
                              asset: { select: { id: true, storageKey: true, fileName: true, mimeType: true, sizeBytes: true, drmProtected: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!enrollment?.product.course) return null;
  const course = enrollment.product.course;
  const gate = await curriculumGate({ courseId: course.id, enrolledAt: enrollment.createdAt, batchId: enrollment.batchId });

  const counts: Record<OfflineVerdict, number> = { OFFERED: 0, NOT_DOWNLOADABLE: 0, NOT_A_FILE: 0, PROTECTED: 0, LOCKED: 0 };
  const items = [];
  for (const { module } of course.modules) {
    if (!gate.teaches(module.id)) continue;
    for (const section of module.sections) {
      for (const m of section.materials) {
        const verdict = offlineVerdict({
          type: m.type,
          isDownloadable: m.isDownloadable,
          hasFile: Boolean(m.asset),
          drmProtected: Boolean(m.asset?.drmProtected),
          locked: Boolean(gate.lockOf(m.id, section.id)),
        });
        counts[verdict] += 1;
        if (verdict !== 'OFFERED' || !m.asset) continue;
        const bytes = Number(m.asset.sizeBytes);
        items.push({
          materialId: m.id,
          title: m.title,
          module: module.name,
          section: section.title,
          type: m.type,
          typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
          /** Played inside the app; everything else opens in the phone's own viewer. */
          playable: m.type === 'VIDEO' || m.type === 'AUDIO',
          durationSeconds: m.durationSeconds,
          fileName: m.asset.fileName,
          mimeType: m.asset.mimeType,
          sizeBytes: bytes,
          sizeLabel: sizeLabel(bytes),
          /** Changes when the file behind the lesson is replaced, so the phone knows to fetch it again. */
          version: m.asset.id,
          url: readUrlFor(m.asset.storageKey, { expiresIn: 1800, mimeType: m.asset.mimeType }),
        });
      }
    }
  }

  return {
    productId: enrollment.product.id,
    title: enrollment.product.title,
    checkAgainBy: licenceUntil(now).toISOString(),
    licenceDays: OFFLINE_LICENCE_DAYS,
    items,
    /** Downloadable lessons this learner cannot have yet: not opened, or protected. */
    notYet: counts.LOCKED,
    protected: counts.PROTECTED,
  };
}
