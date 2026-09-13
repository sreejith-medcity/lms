import { db } from '@/lib/db';
import { initialCmi, type Cmi } from './data-model';
import { mintLaunchToken } from './access';
import type { ScormLaunch } from '@/components/scorm-player';

/** Everything the frame needs, with the learner's saved state folded in. */
export async function scormLaunchFor(organizationId: string, materialId: string, userId: string, userName: string): Promise<ScormLaunch | null> {
  const pkg = await db.scormPackage.findFirst({ where: { materialId, organizationId }, select: { id: true, standard: true, launchPath: true, masteryScore: true, identifier: true } });
  if (!pkg) return null;
  const attempt = await db.scormAttempt.findUnique({ where: { packageId_userId: { packageId: pkg.id, userId } }, select: { lessonStatus: true, suspendData: true, location: true, totalSeconds: true, scoreRaw: true, cmi: true } });
  const standard = pkg.standard as ScormLaunch['standard'];
  const contentUrl = `/api/scorm/${pkg.id}/content/${pkg.launchPath.split('/').map(encodeURIComponent).join('/')}`;
  const saved = (attempt?.cmi ?? null) as Cmi | null;
  const cmi = standard === 'XAPI' ? {} : initialCmi(standard, { learnerId: userId, learnerName: userName, saved, lessonStatus: attempt?.lessonStatus ?? 'not attempted', suspendData: attempt?.suspendData ?? null, location: attempt?.location ?? null, totalSeconds: attempt?.totalSeconds ?? 0, masteryScore: pkg.masteryScore, scoreRaw: attempt?.scoreRaw ?? null });
  const launch: ScormLaunch = { packageId: pkg.id, standard, contentUrl, initialCmi: cmi, lessonStatus: attempt?.lessonStatus ?? 'not attempted' };
  if (standard === 'XAPI') {
    launch.xapi = {
      endpoint: `/api/xapi/${pkg.id}/`,
      auth: `Basic ${mintLaunchToken(pkg.id, userId)}`,
      actor: JSON.stringify({ objectType: 'Agent', name: userName, account: { homePage: 'urn:lms', name: userId } }),
      activityId: pkg.identifier ?? `urn:lms:package:${pkg.id}`,
      registration: `${pkg.id}-${userId}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 36),
    };
  }
  return launch;
}
