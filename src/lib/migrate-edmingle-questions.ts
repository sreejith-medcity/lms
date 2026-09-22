import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { bankQuestionsPage, edmingleFor, questionBanks } from '@/lib/edmingle';
import { questionRows } from '@/lib/edmingle-records';
import { migrated, mark, problem, report, sample, type EdmingleReport } from '@/lib/migrate-edmingle';

/**
 * Edmingle's question banks into ours.
 *
 * A bank becomes a bank; each question becomes one question per part,
 * with its options and the correct ones marked, or its accepted answers
 * for a blank, or nothing for a written answer a trainer marks. Audio
 * and pictures attached to a question do not come (they live where the
 * videos live) and the question is tagged so they can be added by hand.
 * Tests built on the banks are not brought: an assessment here is a few
 * clicks over a bank, and Edmingle's test settings do not map cleanly.
 */

const BUDGET_MS = 45_000;

export async function importQuestions(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('questions');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;

  let banks;
  try {
    banks = await questionBanks(client);
  } catch (err) {
    problem(r, err instanceof Error ? err.message : String(err));
    return r;
  }
  const [doneBanks, doneFull, doneQuestions] = await Promise.all([migrated('qbank'), migrated('qbank-full'), migrated('question')]);
  r.looked = banks.length;
  sample(r, `${banks.length} question banks in Edmingle, ${banks.reduce((n, b) => n + (b.total_questions ?? 0), 0)} questions.`);

  let processed = 0;
  let throttled = false;
  const left = () => budget - (Date.now() - started);
  const pending = banks.filter((b) => !doneFull.has(String(b.question_list_id)));
  for (const b of pending) {
    // A bank of many pages is read page by page across presses: a call to
    // Edmingle can wait half a minute on its rate limit, so the clock is
    // checked before every page, not only before every bank, or a press
    // outlives the gateway and the page shows an error instead of a report.
    if (left() < 8_000) break;
    // A rehearsal reads two banks as a sample and leaves Edmingle's call allowance for the real run.
    if (options.dryRun && processed >= 2) break;
    const key = String(b.question_list_id);
    let bankId = doneBanks.get(key) ?? null;
    if (!bankId) {
      r.wouldCreate += 1;
      if (options.dryRun) sample(r, `bank: ${b.question_list_name} (${b.total_questions ?? '?'} questions)`);
      else {
        try {
          const created = await db.questionBank.create({
            data: { organizationId, name: b.question_list_name.trim().slice(0, 200) || `Bank ${key}`, topic: b.engage_topic_tag_name?.trim() || null },
            select: { id: true },
          });
          bankId = created.id;
          await mark('qbank', key, bankId, { name: b.question_list_name, type: b.question_type ?? null });
        } catch (err) {
          problem(r, `bank ${b.question_list_name}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
      }
    } else r.alreadyDone += 1;

    let complete = true;
    let media = 0;
    for (let page = 1; page <= 50; page += 1) {
      if (left() < 4_000) {
        complete = false;
        break;
      }
      let got;
      try {
        got = await bankQuestionsPage(client, b.question_list_id, page);
      } catch (err) {
        const said = err instanceof Error ? err.message : String(err);
        problem(r, `${b.question_list_name} page ${page}: ${said}`);
        complete = false;
        // Once Edmingle is throttling, every further call is refused too;
        // stop the press here rather than hammer the next bank.
        if (/rate-limiting/.test(said)) throttled = true;
        break;
      }
      for (const q of got.questions) {
        const qKey = String(q.question_id);
        r.looked += 1;
        if (doneQuestions.has(qKey)) {
          r.alreadyDone += 1;
          continue;
        }
        const rows = questionRows(got.bankType, q);
        if (rows.length === 0) continue;
        r.wouldCreate += rows.length;
        if (rows.some((x) => x.mediaLeftBehind)) media += 1;
        if (options.dryRun) {
          if (r.samples.length < 8) sample(r, `${b.question_list_name}: ${rows[0].type} "${rows[0].promptHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
          continue;
        }
        try {
          const ids: string[] = [];
          for (const [i, row] of rows.entries()) {
            const created = await db.question.create({
              data: {
                bankId: bankId!,
                type: row.type,
                promptHtml: row.promptHtml,
                explanation: row.explanation,
                marks: row.marks,
                negativeMarks: row.negativeMarks,
                answerKey: row.answerKey ? (row.answerKey as unknown as Prisma.InputJsonValue) : undefined,
                tags: ['edmingle', ...(rows.length > 1 ? [`part ${i + 1} of ${rows.length}`] : []), ...(row.mediaLeftBehind ? ['media to add'] : [])],
                options: row.options.length ? { create: row.options.map((o, sortOrder) => ({ label: o.label, isCorrect: o.isCorrect, sortOrder })) } : undefined,
              },
              select: { id: true },
            });
            ids.push(created.id);
          }
          await mark('question', qKey, ids[0], { bank: key, parts: ids.length });
        } catch (err) {
          complete = false;
          problem(r, `${b.question_list_name} question ${qKey}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!got.more) break;
    }
    if (media) sample(r, `${b.question_list_name}: ${media} questions have audio or pictures to add by hand (tagged "media to add").`);
    if (complete || options.dryRun) processed += 1;
    if (!options.dryRun && complete && bankId) await mark('qbank-full', key, bankId);
    if (throttled || left() < 4_000) break;
  }
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, options.dryRun ? `${r.remaining} more banks on the real run (a rehearsal samples two).` : `${r.remaining} banks still to read: press again, or switch on the background run.`);
  return r;
}
