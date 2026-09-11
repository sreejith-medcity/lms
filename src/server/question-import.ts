'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { parseQuestions, type ImportProblem, type ParsedQuestion } from '@/lib/question-import';
import { docxToText } from '@/lib/docx-text';

/**
 * Bulk import into a bank: dry run, then apply.
 *
 * The first pass reads the file, says what it would create and lists every
 * problem with its line. Only then can it be applied, and the apply is the
 * same parse again, so what was promised is what is written. A question
 * whose text already exists in the bank is skipped rather than doubled, which
 * makes re-running a corrected file safe.
 */

export interface ImportPreviewRow {
  line: number;
  type: string;
  prompt: string;
  options: number;
  answer: string;
  difficulty: string;
  marks: number;
  tags: string[];
  duplicate: boolean;
}

export interface QuestionImportResult {
  ok: boolean;
  error?: string;
  format?: 'CSV' | 'TEXT';
  applied: boolean;
  rows: ImportPreviewRow[];
  problems: ImportProblem[];
  summary: { parsed: number; duplicates: number; problems: number; created: number };
}

const MAX_BYTES = 5 * 1024 * 1024;
const LETTERS = 'ABCDEFGHIJ';

function normalise(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function textFrom(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: 'That file is over 5 MB. Split it up.' };
    const name = file.name.toLowerCase();
    const bytes = Buffer.from(await file.arrayBuffer());
    if (name.endsWith('.docx')) {
      try {
        return { text: docxToText(bytes) };
      } catch {
        return { error: 'That does not read as a Word document. Save it as .docx and try again.' };
      }
    }
    if (name.endsWith('.doc')) {
      return { error: 'Old .doc files are not readable here. Open it in Word and save as .docx.' };
    }
    return { text: bytes.toString('utf8') };
  }
  const pasted = String(formData.get('text') ?? '');
  if (!pasted.trim()) return { error: 'Paste the questions or choose a file.' };
  return { text: pasted };
}

export async function importQuestions(
  bankId: string,
  formData: FormData,
  apply: boolean,
): Promise<QuestionImportResult> {
  const empty = { parsed: 0, duplicates: 0, problems: 0, created: 0 };
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(),
      requireStaff('question_bank.manage_questions', 'edit'),
    ]);

    const bank = await db.questionBank.findFirst({
      where: { id: bankId, organizationId: tenant.organizationId },
      select: { id: true, name: true, questions: { select: { promptHtml: true } } },
    });
    if (!bank) return { ok: false, error: 'Bank not found.', applied: false, rows: [], problems: [], summary: empty };

    const source = await textFrom(formData);
    if ('error' in source) {
      return { ok: false, error: source.error, applied: false, rows: [], problems: [], summary: empty };
    }

    const parsed = parseQuestions(source.text);

    const existing = new Set(bank.questions.map((q) => normalise(q.promptHtml)));
    const seenInFile = new Set<string>();
    const fresh: ParsedQuestion[] = [];

    const rows: ImportPreviewRow[] = parsed.questions.map((q) => {
      const key = normalise(q.prompt);
      const duplicate = existing.has(key) || seenInFile.has(key);
      seenInFile.add(key);
      if (!duplicate) fresh.push(q);
      return {
        line: q.line,
        type: q.type,
        prompt: q.prompt,
        options: q.options.length,
        answer:
          q.options.length > 0
            ? q.options.map((o, i) => (o.isCorrect ? LETTERS[i] : null)).filter(Boolean).join(', ')
            : 'written',
        difficulty: q.difficulty,
        marks: q.marks,
        tags: q.tags,
        duplicate,
      };
    });

    const summary = {
      parsed: parsed.questions.length,
      duplicates: rows.filter((r) => r.duplicate).length,
      problems: parsed.problems.length,
      created: 0,
    };

    if (!apply) {
      return { ok: true, format: parsed.format, applied: false, rows, problems: parsed.problems, summary };
    }

    if (!fresh.length) {
      return {
        ok: false,
        error: parsed.questions.length ? 'Everything in the file is already in this bank.' : 'Nothing to import.',
        format: parsed.format,
        applied: false,
        rows,
        problems: parsed.problems,
        summary,
      };
    }

    // Written in batches so a file of a thousand does not hold one
    // transaction open for a minute, and a failure part way leaves whole
    // batches rather than half a question.
    const BATCH = 50;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const slice = fresh.slice(i, i + BATCH);
      await db.$transaction(
        slice.map((q) =>
          db.question.create({
            data: {
              bankId: bank.id,
              type: q.type,
              promptHtml: q.prompt,
              explanation: q.explanation,
              difficulty: q.difficulty,
              marks: q.marks,
              negativeMarks: q.negativeMarks,
              tags: q.tags,
              options: q.options.length
                ? { create: q.options.map((o, sortOrder) => ({ label: o.label, isCorrect: o.isCorrect, sortOrder })) }
                : undefined,
            },
            select: { id: true },
          }),
        ),
      );
      summary.created += slice.length;
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'question.imported',
      entity: 'QuestionBank',
      entityId: bank.id,
      after: { bank: bank.name, created: summary.created, skipped: summary.duplicates, format: parsed.format },
    });

    revalidatePath(`/admin/question-bank/${bank.id}`);
    revalidatePath('/admin/question-bank');
    return { ok: true, format: parsed.format, applied: true, rows, problems: parsed.problems, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED') return { ok: false, error: 'Please sign in again.', applied: false, rows: [], problems: [], summary: empty };
    if (message === 'FORBIDDEN') return { ok: false, error: 'You do not have permission to do that.', applied: false, rows: [], problems: [], summary: empty };
    console.error('[question-import]', message);
    return { ok: false, error: 'Something went wrong. Please try again.', applied: false, rows: [], problems: [], summary: empty };
  }
}
