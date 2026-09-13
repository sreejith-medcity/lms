import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { curriculumGate } from '@/lib/curriculum-access';
import { settingBool, settingText } from '@/lib/settings/store';
import { Card } from '@/components/ui';
import { Rail, type RailModule } from './rail';
import { Stage } from './stage';
import type { QuestionRow } from './questions';
import { learnerOrder, visibleBatches } from '@/lib/lesson-qa';
import { refreshStream } from '@/lib/video';
import { dueForCheck } from '@/lib/video/tokens';
import { captionsDue, pullCaptions, segmentsOf } from '@/lib/transcripts';
import { paragraphs } from '@/lib/captions';
import { PlayerShell } from './shell';

export const dynamic = 'force-dynamic';

export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string; materialId: string }>;
  searchParams: Promise<{ tab?: string; t?: string }>;
}) {
  const { productId, materialId } = await params;
  const { tab, t } = await searchParams;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollment = await db.enrollment.findFirst({
    where: {
      userId: user.id,
      productId,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    select: {
      id: true,
      batchId: true,
      createdAt: true,
      product: { select: { title: true, course: { select: { id: true, description: true } } } },
    },
  });
  if (!enrollment?.product.course) notFound();

  // What the academy's own settings do to the player.
  const [watermarkOn, watermarkShows, blockDownload, blockMenu] = await Promise.all([
    settingBool(tenant.organizationId, 'player.watermark'),
    settingText(tenant.organizationId, 'player.watermarkShows'),
    settingBool(tenant.organizationId, 'player.blockDownload'),
    settingBool(tenant.organizationId, 'player.blockContextMenu'),
  ]);

  const viewer = watermarkOn
    ? await db.user.findUnique({
        where: { id: user.id },
        select: { name: true, email: true, phone: true, registrationNo: true },
      })
    : null;

  const watermark = viewer
    ? watermarkShows === 'NAME'
      ? viewer.name
      : watermarkShows === 'EMAIL'
        ? viewer.email
        : watermarkShows === 'PHONE'
          ? viewer.phone
          : viewer.registrationNo
            ? `#${viewer.registrationNo}`
            : viewer.name
    : null;

  const gate = await curriculumGate({
    courseId: enrollment.product.course.id,
    enrolledAt: enrollment.createdAt,
    batchId: enrollment.batchId,
  });

  const allModules = await db.courseModule.findMany({
    where: { courseId: enrollment.product.course.id },
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
                  assetId: true,
                  externalUrl: true,
                  bodyHtml: true,
                  isDownloadable: true,
                  durationSeconds: true,
                  asset: { select: { streamStatus: true, streamCheckedAt: true, captionsRequestedAt: true, transcript: { select: { segments: true, summary: true, chapters: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  const modules = allModules.filter((cm) => gate.teaches(cm.module.id));

  // Section id travels with the lesson: a drip rule can be written on either.
  const ordered = modules.flatMap((cm) =>
    cm.module.sections.flatMap((s) => s.materials.map((m) => ({ ...m, sectionId: s.id }))),
  );
  const index = ordered.findIndex((m) => m.id === materialId);
  if (index === -1) notFound();

  const material = ordered[index];
  const lock = gate.lockOf(material.id, material.sectionId);

  // A video still encoding: ask the platform on the way past, no more than
  // once a minute, so the stream appears without anyone pressing anything.
  let streamStatus = material.asset?.streamStatus ?? null;
  if (material.assetId && dueForCheck(streamStatus, material.asset?.streamCheckedAt ?? null)) {
    streamStatus = await refreshStream(tenant.organizationId, material.assetId);
  }
  // Captions the platform was asked for: the same on-the-way-past pull.
  let transcriptRow = material.asset?.transcript ?? null;
  if (material.assetId && !transcriptRow && captionsDue(material.asset?.captionsRequestedAt ?? null)) {
    if ((await pullCaptions(tenant.organizationId, material.assetId)) === 'SAVED') {
      transcriptRow = await db.transcript.findUnique({ where: { assetId: material.assetId }, select: { segments: true, summary: true, chapters: true } });
    }
  }
  const transcriptSegments = segmentsOf(transcriptRow?.segments);
  const transcript = transcriptSegments.length
    ? {
        paragraphs: paragraphs(transcriptSegments),
        summary: transcriptRow?.summary ?? null,
        chapters: Array.isArray(transcriptRow?.chapters)
          ? (transcriptRow.chapters as { title?: unknown; start?: unknown }[])
              .filter((c) => typeof c?.title === 'string' && typeof c?.start === 'number')
              .map((c) => ({ title: c.title as string, start: c.start as number }))
          : [],
      }
    : null;
  // Arrived from a search hit: start at that second rather than where they left off.
  const jumpTo = t && Number.isFinite(Number(t)) ? Math.max(0, Math.floor(Number(t))) : null;

  // Skip past locked lessons rather than offering a next that refuses to open.
  const prev = ordered.slice(0, index).reverse().find((m) => !gate.lockOf(m.id, m.sectionId)) ?? null;
  const next = ordered.slice(index + 1).find((m) => !gate.lockOf(m.id, m.sectionId)) ?? null;

  const [progressRows, notes, announcements, questionRows] = await Promise.all([
    db.materialProgress.findMany({
      where: { userId: user.id, materialId: { in: ordered.map((m) => m.id) } },
      select: {
        materialId: true,
        completedAt: true,
        isBookmarked: true,
        positionSeconds: true,
      },
    }),
    db.learnerNote.findMany({
      where: { userId: user.id, materialId },
      orderBy: [{ atSeconds: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, body: true, atSeconds: true, createdAt: true },
    }),
    // What the trainer has said to this batch or this course, newest first.
    db.announcement.findMany({
      where: {
        organizationId: tenant.organizationId,
        publishAt: { lte: new Date() },
        targets: {
          some: {
            OR: [
              { courseId: enrollment.product.course.id },
              ...(enrollment.batchId ? [{ batchId: enrollment.batchId }] : []),
            ],
          },
        },
      },
      orderBy: { publishAt: 'desc' },
      take: 10,
      select: { id: true, title: true, bodyHtml: true, urgency: true, publishAt: true },
    }),
    // Questions on this lesson from this batch, and the course-wide ones.
    db.lessonQuestion.findMany({
      where: {
        organizationId: tenant.organizationId,
        materialId,
        isHidden: false,
        OR: visibleBatches(enrollment.batchId).map((batchId) => ({ batchId })),
      },
      take: 200,
      select: {
        id: true,
        userId: true,
        batchId: true,
        body: true,
        atSeconds: true,
        answer: true,
        answeredById: true,
        answeredAt: true,
        alsoAsking: true,
        isPinned: true,
        isHidden: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const answererIds = Array.from(new Set(questionRows.map((q) => q.answeredById).filter((id): id is string => Boolean(id))));
  const answerers = answererIds.length
    ? await db.user.findMany({ where: { id: { in: answererIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })
    : [];
  const answererName = new Map(answerers.map((a) => [a.id, a.name]));
  const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const questions: QuestionRow[] = learnerOrder(questionRows).map((q) => ({
    id: q.id,
    userId: q.userId,
    askedBy: q.user.name,
    body: q.body,
    atSeconds: q.atSeconds,
    askedAt: shortDate(q.createdAt),
    answer: q.answer,
    answeredBy: q.answeredById ? (answererName.get(q.answeredById) ?? null) : null,
    answeredAt: q.answeredAt ? shortDate(q.answeredAt) : null,
    alsoAsking: q.alsoAsking,
    isPinned: q.isPinned,
  }));

  const byMaterial = new Map(progressRows.map((p) => [p.materialId, p]));
  const here = byMaterial.get(materialId);

  const railModules: RailModule[] = modules.map((cm) => ({
    id: cm.module.id,
    name: cm.module.name,
    sections: cm.module.sections.map((s) => ({
      id: s.id,
      title: s.title,
      materials: s.materials.map((m) => {
        const materialLock = gate.lockOf(m.id, s.id);
        return {
          id: m.id,
          title: m.title,
          typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
          duration: formatDuration(m.durationSeconds),
          done: Boolean(byMaterial.get(m.id)?.completedAt),
          bookmarked: Boolean(byMaterial.get(m.id)?.isBookmarked),
          lockedLabel: materialLock?.label ?? null,
        };
      }),
    })),
  }));

  const completed = ordered.filter((m) => byMaterial.get(m.id)?.completedAt).length;

  // Downloads in the current section, for the Resources tab.
  const section = modules.flatMap((cm) => cm.module.sections).find((s) => s.id === material.sectionId);
  const resources = (section?.materials ?? [])
    .filter((m) => m.assetId && m.isDownloadable && !blockDownload && !gate.lockOf(m.id, section!.id))
    .map((m) => ({
      id: m.id,
      title: m.title,
      typeLabel: MATERIAL_LABELS[m.type] ?? m.type,
      href: `/api/assets/${m.assetId}?download=1`,
    }));

  const stage = lock ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Card className="max-w-md text-center">
            <p className="text-3xl" aria-hidden>
              🔒
            </p>
            <h1 className="t-heading mt-3">{material.title}</h1>
            <p className="t-small muted mt-2">
              This lesson opens on{' '}
              {lock.until.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . Your academy releases this course a piece at a time, so the rest of it is already
              waiting for you.
            </p>
            {next && (
              <Link
                href={`/learn/${productId}/${next.id}`}
                className="mt-4 inline-flex rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                Go to the next open lesson
              </Link>
            )}
          </Card>
        </div>
      ) : (
      <Stage
        courseTitle={enrollment.product.title}
        courseDescription={enrollment.product.course.description}
        sectionTitle={section?.title ?? null}
        discussionHref={`/learn/${productId}/discussion`}
        initialTab={tab === 'qa' || tab === 'notes' || tab === 'announcements' || tab === 'resources' || tab === 'transcript' ? tab : undefined}
        transcript={transcript}
        searchHref={`/learn/${productId}/search`}
        me={user.id}
        questions={questions}
        announcements={announcements.map((a) => ({
          id: a.id,
          title: a.title,
          bodyHtml: a.bodyHtml,
          urgent: a.urgency === 'HIGH',
          publishedAt: a.publishAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        }))}
        resources={resources}
        productId={productId}
        material={{
          id: material.id,
          title: material.title,
          type: material.type,
          typeLabel: MATERIAL_LABELS[material.type] ?? material.type,
          assetId: material.assetId,
          externalUrl: material.externalUrl,
          bodyHtml: material.bodyHtml,
          isDownloadable: material.isDownloadable && !blockDownload,
          durationSeconds: material.durationSeconds,
          streamReady: streamStatus === 'READY',
        }}
        position={index + 1}
        total={ordered.length}
        startAt={jumpTo ?? here?.positionSeconds ?? 0}
        done={Boolean(here?.completedAt)}
        bookmarked={Boolean(here?.isBookmarked)}
        prevId={prev?.id ?? null}
        nextId={next?.id ?? null}
        watermark={watermark}
        blockContextMenu={blockMenu}
        notes={notes.map((n) => ({
          id: n.id,
          body: n.body,
          atSeconds: n.atSeconds,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
      );

  return (
    <PlayerShell
      productId={productId}
      courseTitle={enrollment.product.title}
      completed={completed}
      total={ordered.length}
      stage={stage}
      rail={<Rail productId={productId} currentId={materialId} modules={railModules} />}
    />
  );
}
