import { db } from '@/lib/db';
import { curriculumGate } from '@/lib/curriculum-access';
import { MATERIAL_LABELS } from '@/lib/progress';
import { readUrlFor } from '@/lib/storage';
import { playbackFor } from '@/lib/video';
import type { Segment } from '@/lib/captions';
import type { TenantContext } from '@/lib/tenant';
import type { ApiUser } from './auth';

/**
 * One lesson for the app: what it is, where its file or stream is (links
 * signed for the session, minted only after the entitlement and drip
 * checks), captions inline, and where the learner left it.
 */

export type LessonLookup = { ok: true; enrollmentId: string; courseId: string; productId: string; materialId: string } | { ok: false; code: 'not_enrolled' | 'locked'; message: string; until?: string };

export async function lessonEntitlement(tenant: TenantContext, user: ApiUser, materialId: string): Promise<LessonLookup> {
  const enrollment = await db.enrollment.findFirst({
    where: { organizationId: tenant.organizationId, userId: user.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, product: { course: { modules: { some: { module: { sections: { some: { materials: { some: { id: materialId } } } } } } } } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, batchId: true, createdAt: true, productId: true, product: { select: { course: { select: { id: true } } } } },
  });
  if (!enrollment?.product.course) return { ok: false, code: 'not_enrolled', message: 'This lesson is not part of your enrolment.' };
  const material = await db.material.findUnique({ where: { id: materialId }, select: { sectionId: true, section: { select: { isVisible: true } } } });
  if (!material?.section.isVisible) return { ok: false, code: 'locked', message: 'This lesson has not opened yet.' };
  const gate = await curriculumGate({ courseId: enrollment.product.course.id, enrolledAt: enrollment.createdAt, batchId: enrollment.batchId });
  const lock = gate.lockOf(materialId, material.sectionId);
  if (lock) return { ok: false, code: 'locked', message: lock.label, until: lock.until.toISOString() };
  return { ok: true, enrollmentId: enrollment.id, courseId: enrollment.product.course.id, productId: enrollment.productId, materialId };
}

export async function lessonDetail(tenant: TenantContext, user: ApiUser, materialId: string) {
  const ent = await lessonEntitlement(tenant, user, materialId);
  if (!ent.ok) return ent;
  const m = await db.material.findUnique({
    where: { id: materialId },
    select: {
      id: true, title: true, type: true, externalUrl: true, bodyHtml: true, durationSeconds: true, isDownloadable: true,
      asset: { select: { id: true, storageKey: true, mimeType: true, fileName: true, streamProvider: true, streamId: true, streamPlaybackId: true, streamStatus: true, transcript: { select: { segments: true, summary: true, chapters: true } } } },
      scorm: { select: { id: true, standard: true } },
    },
  });
  if (!m) return { ok: false as const, code: 'not_enrolled' as const, message: 'Lesson not found.' };
  const progress = await db.materialProgress.findUnique({ where: { userId_materialId: { userId: user.id, materialId } }, select: { positionSeconds: true, completedAt: true, percent: true } });

  let fileUrl: string | null = null;
  let downloadUrl: string | null = null;
  let stream: { hls: string; thumbnail: string | null; expiresAt: string } | null = null;
  if (m.asset && m.type !== 'SCORM') {
    const streaming = m.type === 'VIDEO' || m.type === 'AUDIO';
    fileUrl = readUrlFor(m.asset.storageKey, { expiresIn: streaming ? 7200 : 600, mimeType: m.asset.mimeType });
    if (m.isDownloadable) downloadUrl = readUrlFor(m.asset.storageKey, { expiresIn: 600, mimeType: m.asset.mimeType, downloadName: m.asset.fileName });
    if (streaming) {
      const p = await playbackFor(tenant.organizationId, m.asset);
      if (p) stream = { hls: p.hlsUrl, thumbnail: p.thumbnailUrl, expiresAt: p.expiresAt.toISOString() };
    }
  }
  const segments = (m.asset?.transcript?.segments ?? null) as Segment[] | null;
  return {
    ok: true as const,
    id: m.id,
    productId: ent.productId,
    title: m.title,
    type: m.type,
    typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
    durationSeconds: m.durationSeconds,
    externalUrl: m.externalUrl,
    bodyHtml: m.bodyHtml,
    fileUrl,
    downloadUrl,
    stream,
    captions: segments ? segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) : null,
    summary: m.asset?.transcript?.summary ?? null,
    chapters: (m.asset?.transcript?.chapters ?? null) as { title: string; start: number }[] | null,
    /** Interactive packages open on the web, signed in through /auth/web. */
    webPath: m.type === 'SCORM' ? `/learn/${ent.productId}/${m.id}` : null,
    progress: { positionSeconds: progress?.positionSeconds ?? 0, percent: Math.round(progress?.percent ?? 0), completed: Boolean(progress?.completedAt) },
  };
}
