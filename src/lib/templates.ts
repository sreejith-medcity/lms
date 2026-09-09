/**
 * Message templates and the variables they carry.
 *
 * Nothing sends yet, so the value here is the discipline: a template names the
 * variables it uses, and a campaign cannot be prepared with a variable nobody
 * can fill. That is the check that stops "Hi {{first_name}}," going out to
 * four hundred people as literal text.
 */

export const TEMPLATE_VARIABLES = [
  { key: 'name', label: "The learner's full name" },
  { key: 'first_name', label: 'Their first name' },
  { key: 'academy', label: 'The academy name' },
  { key: 'course', label: 'The course this is about, when there is one' },
  { key: 'batch', label: 'The batch this is about, when there is one' },
  { key: 'link', label: 'A link back to the site' },
] as const;

export type VariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];

const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Every variable a body or subject refers to, in the order they first appear. */
export function variablesUsed(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

export function unknownVariables(text: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));
  return variablesUsed(text).filter((v) => !known.has(v));
}

export function render(text: string, values: Record<string, string | null | undefined>): string {
  return text.replace(PATTERN, (whole, key: string) => {
    const value = values[key];
    return value == null || value === '' ? whole : value;
  });
}

/** A preview with plausible values, so somebody can see the shape before sending. */
export function preview(text: string, academy: string): string {
  return render(text, {
    name: 'Anjali Menon',
    first_name: 'Anjali',
    academy,
    course: 'German A1',
    batch: 'A1 Evening — Kochi',
    link: 'https://example.com/learn',
  });
}

export const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  PUSH: 'Push notification',
  IN_APP: 'In the app',
};

export const AUDIENCES = [
  { value: 'ALL_LEARNERS', label: 'Every learner' },
  { value: 'BATCH', label: 'One batch' },
  { value: 'COURSE', label: 'Everyone on one course' },
  { value: 'ABANDONED_CART', label: 'People who left a cart' },
  { value: 'INACTIVE_30D', label: 'Nobody has seen them for 30 days' },
] as const;

export type AudienceKind = (typeof AUDIENCES)[number]['value'];
