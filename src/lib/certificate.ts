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
  /** A hex colour for the rule and the headline; blank means the academy's brand colour. */
  accent: string;
  /** A full-page picture behind everything, A4 landscape. Blank means the plain typeset page. */
  backgroundAssetId: string;
  /** A picture of the signature, drawn above the signatory's name. */
  signatureAssetId: string;
  /** The academy's mark at the top. */
  showLogo: boolean;
  /** A QR code to the public verify page. */
  showQr: boolean;
  /** The serial in the corner. Off only when the background already carries its own numbering. */
  showSerial: boolean;
  /** The border and top rule. Off when the background is a finished design of its own. */
  showFrame: boolean;
  font: 'serif' | 'sans';
}

export const DEFAULT_DESIGN: CertificateDesign = {
  headline: 'Certificate of Completion',
  body: 'This is to certify that {{learner}} has successfully completed {{course}} at {{academy}} on {{date}}.',
  signatoryName: '',
  signatoryRole: 'Director',
  accent: '',
  backgroundAssetId: '',
  signatureAssetId: '',
  showLogo: true,
  showQr: true,
  showSerial: true,
  showFrame: true,
  font: 'serif',
};

export function readDesign(value: Prisma.JsonValue | null | undefined): CertificateDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_DESIGN;
  const v = value as Record<string, unknown>;
  const str = (k: keyof CertificateDesign) => (typeof v[k] === 'string' ? (v[k] as string) : (DEFAULT_DESIGN[k] as string));
  const bool = (k: keyof CertificateDesign) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : (DEFAULT_DESIGN[k] as boolean));
  return {
    headline: str('headline'),
    body: str('body'),
    signatoryName: typeof v.signatoryName === 'string' ? v.signatoryName : '',
    signatoryRole: typeof v.signatoryRole === 'string' ? v.signatoryRole : '',
    accent: isHex(v.accent) ? (v.accent as string) : '',
    backgroundAssetId: str('backgroundAssetId'),
    signatureAssetId: str('signatureAssetId'),
    showLogo: bool('showLogo'),
    showQr: bool('showQr'),
    showSerial: bool('showSerial'),
    showFrame: bool('showFrame'),
    font: v.font === 'sans' ? 'sans' : 'serif',
  };
}

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** "#087447" to the 0..1 triple pdf-lib wants. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = isHex(hex) ? hex : '#322046';
  return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 };
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
