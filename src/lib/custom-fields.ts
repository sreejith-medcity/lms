import { db } from '@/lib/db';
import type { $Enums } from '@prisma/client';

/**
 * Custom fields, generalised.
 *
 * Edmingle ships twenty-five learner fields and no way to add a twenty-sixth
 * without asking them. The same machinery here covers eight entities, because
 * once you have typed fields with values keyed by entity id, restricting it to
 * learners is a choice rather than a saving.
 *
 * The timing flag is the part everybody gets wrong. A field asked *before*
 * signup is a barrier to signing up; one asked *after* is a form somebody fills
 * in when they already have an account and a reason to care. Most fields should
 * be after, and the screen says so.
 */

export const FIELD_ENTITIES: { value: $Enums.CustomFieldEntity; label: string; note: string }[] = [
  { value: 'LEARNER', label: 'Learners', note: 'Shown on signup, on the offline form, and on their record.' },
  { value: 'INSTRUCTOR', label: 'Instructors', note: 'On the staff record, never public.' },
  { value: 'COURSE', label: 'Courses', note: 'Extra facts about a course, for your own team.' },
  { value: 'BATCH', label: 'Batches', note: 'Room number, exam centre, anything the office tracks per cohort.' },
  { value: 'CERTIFICATE', label: 'Certificates', note: 'Printed onto the certificate template.' },
  { value: 'QUESTION', label: 'Questions', note: 'Tags and metadata for the question bank.' },
  { value: 'ANNOUNCEMENT', label: 'Announcements', note: 'Rarely needed; here for completeness.' },
  { value: 'ENQUIRY', label: 'Enquiries', note: 'What the front desk asks that a lead form does not.' },
];

export const FIELD_TYPES: { value: $Enums.CustomFieldType; label: string; hint: string }[] = [
  { value: 'TEXT', label: 'Text', hint: 'One line.' },
  { value: 'NUMBER', label: 'Number', hint: 'Digits only; sorts and filters as a number.' },
  { value: 'DATE', label: 'Date', hint: 'A date picker, stored unambiguously.' },
  { value: 'DROPDOWN', label: 'One of a list', hint: 'Pick one. Comparable across people, unlike free text.' },
  { value: 'MULTISELECT', label: 'Several of a list', hint: 'Pick any number.' },
  { value: 'BOOLEAN', label: 'Yes or no', hint: 'A single checkbox.' },
  { value: 'FILE', label: 'A file', hint: 'An upload, stored like any other asset.' },
];

export interface FieldValue {
  definitionId: string;
  key: string;
  label: string;
  type: $Enums.CustomFieldType;
  options: string[];
  required: boolean;
  value: unknown;
}

export function optionsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [];
}

/** The fields to put on the signup form, in order, for one timing. */
export async function signupFields(
  organizationId: string,
  timing: $Enums.SignupTiming,
) {
  return db.customFieldDefinition.findMany({
    where: {
      organizationId,
      entity: 'LEARNER',
      isActive: true,
      showOnSignup: true,
      signupTiming: timing,
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      key: true,
      label: true,
      type: true,
      options: true,
      signupRequired: true,
    },
  });
}

/** Everything defined for one record, with whatever has been filled in. */
export async function fieldsFor(
  organizationId: string,
  entity: $Enums.CustomFieldEntity,
  entityId: string,
): Promise<FieldValue[]> {
  const definitions = await db.customFieldDefinition.findMany({
    where: { organizationId, entity, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, key: true, label: true, type: true, options: true, signupRequired: true },
  });
  if (definitions.length === 0) return [];

  const values = await db.customFieldValue.findMany({
    where: { definitionId: { in: definitions.map((d) => d.id) }, entityId },
    select: { definitionId: true, value: true },
  });
  const byDefinition = new Map(values.map((v) => [v.definitionId, v.value]));

  return definitions.map((d) => ({
    definitionId: d.id,
    key: d.key,
    label: d.label,
    type: d.type,
    options: optionsOf(d.options),
    required: d.signupRequired,
    value: byDefinition.get(d.id) ?? null,
  }));
}

/** Writes the values submitted with a form, ignoring anything not defined. */
export async function saveFieldValues(input: {
  organizationId: string;
  entity: $Enums.CustomFieldEntity;
  entityId: string;
  userId?: string | null;
  values: Record<string, string>;
}): Promise<void> {
  const definitions = await db.customFieldDefinition.findMany({
    where: { organizationId: input.organizationId, entity: input.entity, isActive: true },
    select: { id: true, key: true, type: true },
  });

  for (const definition of definitions) {
    const raw = input.values[definition.key];
    if (raw === undefined) continue;

    const value =
      definition.type === 'NUMBER'
        ? Number(raw)
        : definition.type === 'BOOLEAN'
          ? raw === 'on' || raw === 'true'
          : definition.type === 'MULTISELECT'
            ? raw.split(',').map((v) => v.trim()).filter(Boolean)
            : raw;

    await db.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId: definition.id, entityId: input.entityId } },
      create: {
        definitionId: definition.id,
        entityId: input.entityId,
        userId: input.userId ?? null,
        value: value as never,
      },
      update: { value: value as never },
    });
  }
}
