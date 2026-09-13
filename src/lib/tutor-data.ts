import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { askClaude } from '@/lib/anthropic';
import { settingNumber } from '@/lib/settings/store';
import { segmentsOf } from '@/lib/transcripts';
import {
  TUTOR_HISTORY,
  buildContext,
  parseCitations,
  parseQuiz,
  parseSummary,
  quizPrompt,
  renderContext,
  summaryPrompt,
  transcriptForPrompt,
  tutorSystemPrompt,
  type Citation,
  type DraftQuestion,
  type LessonContext,
  type LessonSummary,
} from '@/lib/tutor';

/**
 * The tutor and the lesson tools against the database and the model.
 */

const TUTOR_KEY = 'tutor';

/** Plain text out of a lesson's HTML, enough for the tutor to read. */
export function textOfHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Messages a learner has sent the tutor in the last day, against the setting. */
export async function tutorAllowance(organizationId: string, userId: string): Promise<{ used: number; limit: number }> {
  const [limit, used] = await Promise.all([
    settingNumber(organizationId, 'ai.tutorPerDay'),
    db.aiMessage.count({
      where: {
        role: 'user',
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        conversation: { userId, agent: { organizationId, key: TUTOR_KEY } },
      },
    }),
  ]);
  return { used, limit: Math.max(1, limit || 30) };
}

async function tutorAgent(organizationId: string) {
  return db.aiAgent.upsert({
    where: { organizationId_key: { organizationId, key: TUTOR_KEY } },
    create: { organizationId, key: TUTOR_KEY, name: 'Course tutor', audience: 'LEARNER', systemPrompt: 'Grounded in the course. See src/lib/tutor.ts.', isEnabled: true },
    update: {},
    select: { id: true },
  });
}

/** One conversation per learner per course, so the thread carries across lessons. */
async function conversationFor(organizationId: string, userId: string, courseId: string) {
  const agent = await tutorAgent(organizationId);
  const existing = await db.aiConversation.findFirst({
    where: { agentId: agent.id, userId, courseId },
    select: { id: true },
  });
  if (existing) return existing;
  return db.aiConversation.create({ data: { agentId: agent.id, userId, courseId, title: 'Course tutor' }, select: { id: true } });
}

export interface TutorTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  at: string;
}

export async function tutorHistory(organizationId: string, userId: string, courseId: string, take = 20): Promise<TutorTurn[]> {
  const agent = await db.aiAgent.findUnique({ where: { organizationId_key: { organizationId, key: TUTOR_KEY } }, select: { id: true } });
  if (!agent) return [];
  const conversation = await db.aiConversation.findFirst({ where: { agentId: agent.id, userId, courseId }, select: { id: true } });
  if (!conversation) return [];
  const rows = await db.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, role: true, content: true, citations: true, createdAt: true },
  });
  return rows
    .reverse()
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      citations: Array.isArray(r.citations) ? (r.citations as unknown as Citation[]) : [],
      at: r.createdAt.toISOString(),
    }));
}

/** Everything the course has to read: each lesson's text and transcript. */
async function courseReading(organizationId: string, courseId: string): Promise<LessonContext[]> {
  const materials = await db.material.findMany({
    where: {
      section: { module: { courses: { some: { courseId } } }, isVisible: true },
      OR: [{ bodyHtml: { not: null } }, { asset: { organizationId, transcript: { isNot: null } } }],
    },
    select: { id: true, title: true, bodyHtml: true, asset: { select: { transcript: { select: { segments: true } } } } },
    take: 200,
  });
  return materials.map((m) => ({
    materialId: m.id,
    title: m.title,
    body: textOfHtml(m.bodyHtml),
    segments: segmentsOf(m.asset?.transcript?.segments),
  }));
}

export async function askTheTutor(input: {
  organizationId: string;
  academy: string;
  userId: string;
  courseId: string;
  courseTitle: string;
  materialId: string;
  question: string;
}): Promise<{ answer: string; citations: Citation[] }> {
  const reading = await courseReading(input.organizationId, input.courseId);
  const here = reading.find((r) => r.materialId === input.materialId) ?? { materialId: input.materialId, title: 'This lesson', body: '', segments: [] };
  const others = reading.filter((r) => r.materialId !== input.materialId);
  const blocks = buildContext(input.question, here, others);

  const conversation = await conversationFor(input.organizationId, input.userId, input.courseId);
  const history = (await tutorHistory(input.organizationId, input.userId, input.courseId, TUTOR_HISTORY)).map((t) => ({ role: t.role, content: t.content }));

  const system = `${tutorSystemPrompt({ academy: input.academy, course: input.courseTitle, lessonTitle: here.title })}\n\nCOURSE MATERIAL:\n${renderContext(blocks) || '(no transcript or text for this lesson yet)'}`;

  const reply = await askClaude({
    organizationId: input.organizationId,
    system,
    user: input.question,
    history,
    maxTokens: 700,
    purpose: 'Tutored a learner',
  });
  const citations = parseCitations(reply.text);

  await db.aiMessage.createMany({
    data: [
      { conversationId: conversation.id, role: 'user', content: input.question, tokensIn: reply.inputTokens, tokensOut: 0 },
      { conversationId: conversation.id, role: 'assistant', content: reply.text, citations: citations as unknown as Prisma.InputJsonValue, tokensIn: 0, tokensOut: reply.outputTokens },
    ],
  });
  await db.aiConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  return { answer: reply.text, citations };
}

/* Lesson tools -------------------------------------------------------------- */

export async function summariseLesson(organizationId: string, assetId: string): Promise<LessonSummary | null> {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { name: true, durationSeconds: true, transcript: { select: { id: true, segments: true } }, materials: { select: { title: true }, take: 1 } },
  });
  if (!asset?.transcript) return null;
  const segments = segmentsOf(asset.transcript.segments);
  if (segments.length === 0) return null;
  const prompt = summaryPrompt({ lessonTitle: asset.materials[0]?.title ?? asset.name, text: transcriptForPrompt(segments) });
  const reply = await askClaude({ organizationId, system: prompt.system, user: prompt.user, maxTokens: 1200, purpose: 'Summarised a lesson' });
  const parsed = parseSummary(reply.text, asset.durationSeconds ?? null);
  if (!parsed) return null;
  await db.transcript.update({
    where: { id: asset.transcript.id },
    data: { summary: parsed.summary, chapters: parsed.chapters as unknown as Prisma.InputJsonValue, keyTerms: parsed.keyTerms },
  });
  return parsed;
}

export async function draftQuiz(organizationId: string, assetId: string, count: number): Promise<{ lessonTitle: string; questions: DraftQuestion[] } | null> {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { name: true, transcript: { select: { segments: true } }, materials: { select: { title: true }, take: 1 } },
  });
  if (!asset?.transcript) return null;
  const segments = segmentsOf(asset.transcript.segments);
  if (segments.length === 0) return null;
  const lessonTitle = asset.materials[0]?.title ?? asset.name;
  const prompt = quizPrompt({ lessonTitle, text: transcriptForPrompt(segments, 30_000), count: Math.max(1, Math.min(20, count)) });
  const reply = await askClaude({ organizationId, system: prompt.system, user: prompt.user, maxTokens: 3000, purpose: 'Wrote quiz questions from a lesson' });
  return { lessonTitle, questions: parseQuiz(reply.text) };
}
