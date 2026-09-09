/**
 * The shape of a feedback form.
 *
 * Kept out of the server-actions module because everything exported from one of
 * those becomes a callable endpoint, and a list of question types is not an
 * endpoint. The builder, the learner's form and the results page all read it.
 */

export const QUESTION_TYPES = ['RATING', 'SCALE', 'CHOICE', 'YES_NO', 'TEXT'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface FeedbackQuestion {
  key: string;
  label: string;
  type: QuestionType;
  options?: string[];
  required?: boolean;
}

export const FORM_TYPES = ['SESSION', 'BATCH', 'TRAINER', 'EVENT', 'CUSTOM'] as const;

export const ANSWER_LABELS: Record<QuestionType, string> = {
  RATING: 'Stars, 1 to 5',
  SCALE: 'A number, 1 to 10',
  CHOICE: 'One of a list',
  YES_NO: 'Yes or no',
  TEXT: 'In their own words',
};

export const FORM_TYPE_LABELS: Record<string, string> = {
  SESSION: 'After a class',
  BATCH: 'About a batch',
  TRAINER: 'About a trainer',
  EVENT: 'After an event',
  CUSTOM: 'Anything else',
};

/** Reads whatever is stored in the JSON column back as questions. */
export function questionsOf(value: unknown): FeedbackQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (q): q is FeedbackQuestion =>
      typeof q === 'object' && q !== null && typeof (q as FeedbackQuestion).key === 'string',
  );
}
