import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { examFormat } from '@/lib/exams/registry';
import { withoutKeys } from '@/lib/exams/draw';
import { audioForPaper } from '@/lib/exams/content';
import { criteriaFor } from '@/lib/exams/marking';
import { paperOf } from '@/lib/exams/sittings';
import { ExamPlayer, type PlayerProps } from './player';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Test' };

export default async function ExamPage({ params }: { params: Promise<{ sittingId: string }> }) {
  const { sittingId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId, userId: user.id } });
  if (!s) notFound();
  if (s.status !== 'IN_PROGRESS') redirect(`/exam/${s.id}/result`);
  const format = examFormat(s.formatCode);
  if (!format) notFound();

  const drawn = paperOf(s);
  const files = await audioForPaper(tenant.organizationId, s.formatCode, drawn);
  const scope = s.sectionId ? [s.sectionId] : null;
  const paper = withoutKeys(drawn)
    .filter((b) => !scope || scope.includes(b.sectionId))
    .map((b) => {
      const def = format.blocks.find((d) => d.id === b.id);
      const marked = def && ['write', 'mitteilung', 'speak'].includes(def.layout);
      return { ...b, criteria: marked && def ? criteriaFor(format, def) : undefined, fileCount: files[b.id]?.length ?? 0 };
    });
  const subs = await db.examSubmission.findMany({ where: { organizationId: tenant.organizationId, sittingId: s.id }, select: { task: true, kind: true, text: true, recordingAssetId: true } });

  const props: PlayerProps = {
    sittingId: s.id,
    formatName: format.name,
    language: format.language,
    mode: s.mode === 'practice' ? 'practice' : 'exam',
    sections: format.sections.filter((x) => !scope || scope.includes(x.id)),
    paper: paper as unknown as PlayerProps['paper'],
    answers: (s.answers ?? {}) as PlayerProps['answers'],
    clocks: (s.sectionClock ?? {}) as PlayerProps['clocks'],
    done: Array.isArray(s.sectionsDone) ? (s.sectionsDone as string[]) : [],
    plays: (s.plays ?? {}) as Record<string, number>,
    notes: (s.notes ?? {}) as Record<string, string>,
    writing: Object.fromEntries(subs.filter((x) => x.kind === 'WRITING').map((x) => [x.task, x.text])),
    recorded: subs.filter((x) => x.kind === 'SPEAKING' && x.recordingAssetId).map((x) => x.task),
    serverNow: Date.now(),
  };
  return <ExamPlayer {...props} />;
}
