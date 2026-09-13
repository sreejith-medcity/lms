'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { viewerFor } from '@/lib/scorm/access';
import { summarise, type Cmi } from '@/lib/scorm/data-model';
import { unpackPackage } from '@/lib/scorm/unpack';
import { markScormMaterialDone } from '@/lib/scorm/progress';
import type { ActionState } from '@/server/courses';

/**
 * The package talking to the LMS. The player collects what the package
 * set and hands it over on commit and on finish; the summary decides
 * whether the lesson is done.
 */

export interface CommitResult {
  ok: boolean;
  done?: boolean;
  lessonStatus?: string;
  error?: string;
}

export async function commitScorm(packageId: string, cmi: Cmi, sessionSeconds: number): Promise<CommitResult> {
  try {
    const viewer = await viewerFor(packageId);
    if (!viewer) return { ok: false, error: 'Not allowed.' };
    const pkg = await db.scormPackage.findUnique({ where: { id: packageId }, select: { organizationId: true, materialId: true, standard: true, masteryScore: true } });
    if (!pkg) return { ok: false, error: 'Package not found.' };
    const existing = await db.scormAttempt.findUnique({ where: { packageId_userId: { packageId, userId: viewer.userId } }, select: { totalSeconds: true, lessonStatus: true } });
    const wasDone = existing?.lessonStatus === 'completed' || existing?.lessonStatus === 'passed';
    const s = summarise(pkg.standard, cmi, pkg.masteryScore, existing?.totalSeconds ?? 0, Math.max(0, Math.round(sessionSeconds)));
    // Once done, a later session that only opens the package does not undo it.
    const lessonStatus = wasDone && !s.done ? existing!.lessonStatus : s.lessonStatus;
    await db.scormAttempt.upsert({
      where: { packageId_userId: { packageId, userId: viewer.userId } },
      create: { packageId, userId: viewer.userId, lessonStatus, scoreRaw: s.scoreRaw, scoreMax: s.scoreMax, scoreMin: s.scoreMin, suspendData: s.suspendData, location: s.location, totalSeconds: s.totalSeconds, cmi: cmi as unknown as Prisma.InputJsonValue },
      update: { lessonStatus, scoreRaw: s.scoreRaw ?? undefined, scoreMax: s.scoreMax ?? undefined, scoreMin: s.scoreMin ?? undefined, suspendData: s.suspendData, location: s.location, totalSeconds: s.totalSeconds, cmi: cmi as unknown as Prisma.InputJsonValue },
    });
    if (s.done && !wasDone && !viewer.staff) await markScormMaterialDone(pkg.organizationId, viewer.userId, pkg.materialId);
    return { ok: true, done: s.done, lessonStatus };
  } catch (err) {
    console.error('[scorm] commit', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not save progress.' };
  }
}

/** The office turning an uploaded zip into an interactive lesson, or refreshing one. */
export async function unpackMaterial(materialId: string, productId: string): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([requireTenant(), requireStaff('module.materials', 'edit')]);
    const material = await db.material.findFirst({ where: { id: materialId, section: { module: { organizationId: tenant.organizationId } } }, select: { id: true, assetId: true, title: true } });
    if (!material?.assetId) return { error: 'This material has no uploaded file.' };
    const r = await unpackPackage({ organizationId: tenant.organizationId, materialId: material.id, assetId: material.assetId });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'scorm.unpack', entity: 'Material', entityId: material.id, after: { standard: r.info.standard, files: r.fileCount, launch: r.info.launchPath } });
    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true, message: `${r.info.standard.replace('_', ' ')} package, ${r.fileCount} files, opens ${r.info.launchPath}.` };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (m === 'UNAUTHORIZED' || m === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
    if (m === 'NO_MANIFEST') return { error: 'That zip has no imsmanifest.xml or tincan.xml, so it is not a SCORM or xAPI package.' };
    if (m === 'NO_LAUNCH_FILE') return { error: 'The manifest names no file to open.' };
    if (m === 'PACKAGE_TOO_LARGE') return { error: 'Packages up to 1 GB can be unpacked.' };
    if (m === 'TOO_MANY_FILES') return { error: 'That package has more than 5,000 files.' };
    if (m === 'NOT_A_ZIP') return { error: 'That file is not a zip.' };
    console.error('[scorm] unpack', m);
    return { error: 'Could not unpack the package.' };
  }
}
