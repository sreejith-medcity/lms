/**
 * Turning a template and a context into a message.
 *
 * The rule that matters: a variable with nothing to fill it is an error, not an
 * empty string. "Hi ," going out to four hundred people is the failure mode this
 * exists to prevent, and it is always caused by rendering being forgiving.
 */

export interface Rendered {
  subject: string;
  body: string;
  /** Names that had nothing to fill them. Non-empty means do not send. */
  missing: string[];
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function variablesIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN)) found.add(match[1]);
  return [...found];
}

function fill(template: string, context: Record<string, string>, missing: Set<string>): string {
  return template.replace(TOKEN, (_whole, name: string) => {
    const value = context[name];
    if (value === undefined || value === null || value === '') {
      missing.add(name);
      return '';
    }
    return value;
  });
}

export function render(
  template: { subject?: string | null; body: string },
  context: Record<string, string>,
): Rendered {
  const missing = new Set<string>();
  return {
    subject: template.subject ? fill(template.subject, context, missing) : '',
    body: fill(template.body, context, missing),
    missing: [...missing],
  };
}

/**
 * Ordered variables, which is how MSG91, AiSensy and most Indian WhatsApp
 * providers take them: the template is approved with numbered placeholders and
 * the API wants an array in that order.
 */
export function orderedVariables(template: string, context: Record<string, string>): string[] {
  return variablesIn(template).map((name) => context[name] ?? '');
}

/** A safe plain-text to HTML for providers that want both. */
export function asHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">${escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}
