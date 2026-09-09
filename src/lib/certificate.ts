import type { Prisma } from '@prisma/client';

/**
 * A certificate's design, kept as a handful of fields rather than a canvas.
 *
 * A drag-and-drop designer is the obvious thing to build and the wrong thing to
 * build first: it produces layouts that break at print size and it is a week of
 * work before anyone can issue anything. This is a fixed, typeset layout with
 * the words an academy actually needs to change, and it prints correctly on A4
 * landscape without anyone tuning it.
 */
export interface CertificateDesign {
  headline: string;
  body: string;
  signatoryName: string;
  signatoryRole: string;
  accent: string;
}

export const DEFAULT_DESIGN: CertificateDesign = {
  headline: 'Certificate of Completion',
  body: 'This is to certify that {{learner}} has successfully completed {{course}} at {{academy}} on {{date}}.',
  signatoryName: '',
  signatoryRole: 'Director',
  accent: '',
};

export function readDesign(value: Prisma.JsonValue | null | undefined): CertificateDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_DESIGN;
  const v = value as Record<string, unknown>;
  return {
    headline: typeof v.headline === 'string' ? v.headline : DEFAULT_DESIGN.headline,
    body: typeof v.body === 'string' ? v.body : DEFAULT_DESIGN.body,
    signatoryName: typeof v.signatoryName === 'string' ? v.signatoryName : '',
    signatoryRole: typeof v.signatoryRole === 'string' ? v.signatoryRole : '',
    accent: typeof v.accent === 'string' ? v.accent : '',
  };
}

export interface MergeValues {
  learner: string;
  course: string;
  academy: string;
  date: string;
  serial: string;
}

/** Only these five, so a template can never reference something that is not there. */
export function merge(text: string, values: MergeValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values ? values[key as keyof MergeValues] : whole,
  );
}

export const MERGE_FIELDS = ['learner', 'course', 'academy', 'date', 'serial'] as const;
