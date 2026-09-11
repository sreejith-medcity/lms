'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import {
  availability,
  drawPaper,
  parseBlueprint,
  seededRandom,
  type BlueprintSection,
  type PoolQuestion,
} from '@/lib/paper-blueprint';
import type { ActionState } from '@/server/courses';

/**
 * Mock papers drawn from the bank by a recipe.
 *
 * The recipe (the blueprint) is sections of "so many questions matching
 * these tags, this difficulty, from these banks". Preview says how many the
 * bank could supply for each section before anything is created; generate
 * draws the paper and saves the recipe on it, so another variant can be
 * drawn later for the same course.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('courses.assessments', 'edit')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[papers]', message);
  return { error: 'Something went wrong. Please try again.' };
}

async function pool(organizationId: string): Promise<PoolQuestion[]> {
  const rows = await db.question.findMany({
    where: { bank: { organizationId } },
    select: { id: true, bankId: true, tags: true, difficulty: true, type: true, marks: true },
  });
  return rows;
}

const recipe = z.object({
  title: z.string().trim().min(2, 'Give the paper a title').max(160),
  kind: z.enum(['TEST', 'MOCK_EXAM', 'PRACTICE']).default('MOCK_EXAM'),
  durationMinutes: z.coerce.number().min(0).max(600).default(0),
  passPercent: z.coerce.number().min(0).max(100).default(40),
  maxAttempts: z.coerce.number().min(1).max(50).default(1),
  shuffleQuestions: z.boolean().default(true),
  sections: z.array(z.unknown()).min(1, 'Add at least one section'),
  seed: z.coerce.number().optional(),
});

export type PaperInput = z.input<typeof recipe>;

export interface PaperPreview {
  ok: boolean;
  error?: string;
  sections: { label: string; wanted: number; available: number }[];
  /** After a trial draw: what a real draw would give. */
  drawn: number;
  totalMarks: number;
  shortfalls: { label: string; wanted: number; drawn: number }[];
}

export async function previewPaper(input: PaperInput): Promise<PaperPreview> {
  try {
    const { tenant } = await guard();
    const parsed = recipe.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message, sections: [], drawn: 0, totalMarks: 0, shortfalls: [] };
    }
    const sections = parseBlueprint(parsed.data.sections);
    if (!sections.length) {
      return { ok: false, error: 'Every section needs a count above zero.', sections: [], drawn: 0, totalMarks: 0, shortfalls: [] };
    }

    const questions = await pool(tenant.organizationId);
    const counts = availability(questions, sections);
    const draw = drawPaper(questions, sections, seededRandom(parsed.data.seed ?? Date.now()));

    return {
      ok: true,
      sections: sections.map((s, i) => ({ label: s.label, wanted: s.count, available: counts[i] })),
      drawn: draw.picks.length,
      totalMarks: draw.totalMarks,
      shortfalls: draw.shortfalls.map((s) => ({ label: sections[s.section].label, wanted: s.wanted, drawn: s.drawn })),
    };
  } catch (err) {
    return { ...fail(err), ok: false, sections: [], drawn: 0, totalMarks: 0, shortfalls: [] };
  }
}

async function writeDraw(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  sections: BlueprintSection[],
  questions: PoolQuestion[],
  seed: number,
) {
  const draw = drawPaper(questions, sections, seededRandom(seed));
  await tx.assessmentQuestion.deleteMany({ where: { assessmentId } });
  if (draw.picks.length) {
    await tx.assessmentQuestion.createMany({
      data: draw.picks.map((p, i) => ({ assessmentId, questionId: p.questionId, sortOrder: i })),
    });
  }
  return draw;
}

export async function generatePaper(input: PaperInput): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard();
    const parsed = recipe.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const sections = parseBlueprint(d.sections);
    if (!sections.length) return { error: 'Every section needs a count above zero.' };

    const questions = await pool(tenant.organizationId);
    if (!questions.length) return { error: 'The bank is empty. Import or write questions first.' };

    const seed = d.seed ?? Math.floor(Math.random() * 2 ** 31);

    const { id, draw } = await db.$transaction(async (tx) => {
      const created = await tx.assessment.create({
        data: {
          organizationId: tenant.organizationId,
          title: d.title,
          kind: d.kind,
          durationMinutes: d.durationMinutes || null,
          passPercent: d.passPercent,
          maxAttempts: d.maxAttempts,
          shuffleQuestions: d.shuffleQuestions,
          blueprint: { sections, seed } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const draw = await writeDraw(tx, created.id, sections, questions, seed);
      return { id: created.id, draw };
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment.generated',
      entity: 'Assessment',
      entityId: id,
      after: { title: d.title, questions: draw.picks.length, shortfalls: draw.shortfalls.length, seed },
    });

    revalidatePath('/admin/assessments');
    const short = draw.shortfalls.length
      ? ` ${draw.shortfalls.length} section${draw.shortfalls.length === 1 ? '' : 's'} came up short; the bank needs more questions there.`
      : '';
    return { ok: true, id, message: `${draw.picks.length} questions drawn, ${draw.totalMarks} marks.${short}` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Draws a fresh variant from the paper's own recipe. Refused once anybody
 * has sat it: their score was earned on the questions that were there.
 */
export async function redrawPaper(assessmentId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const assessment = await db.assessment.findFirst({
      where: { id: assessmentId, organizationId: tenant.organizationId },
      select: { id: true, title: true, blueprint: true, _count: { select: { attempts: true } } },
    });
    if (!assessment) return { error: 'Assessment not found.' };
    if (assessment._count.attempts > 0) {
      return { error: 'This paper has been attempted. Generate a new one from the same recipe instead.' };
    }
    const stored = (assessment.blueprint ?? {}) as { sections?: unknown };
    const sections = parseBlueprint(stored.sections);
    if (!sections.length) return { error: 'This paper was not generated from a recipe.' };

    const questions = await pool(tenant.organizationId);
    const seed = Math.floor(Math.random() * 2 ** 31);

    const draw = await db.$transaction(async (tx) => {
      const result = await writeDraw(tx, assessment.id, sections, questions, seed);
      await tx.assessment.update({
        where: { id: assessment.id },
        data: { blueprint: { sections, seed } as unknown as Prisma.InputJsonValue },
      });
      return result;
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'assessment.redrawn',
      entity: 'Assessment',
      entityId: assessment.id,
      after: { title: assessment.title, questions: draw.picks.length, seed },
    });

    revalidatePath(`/admin/assessments/${assessment.id}`);
    return { ok: true, message: `Redrawn: ${draw.picks.length} questions, ${draw.totalMarks} marks.` };
  } catch (err) {
    return fail(err);
  }
}
