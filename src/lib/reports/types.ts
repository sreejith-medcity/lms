/**
 * One shape for every report.
 *
 * Thirty hand-built pages is thirty places for a definition to drift, thirty
 * exports to remember, and thirty layouts to keep in step. So a report is a
 * declaration — what it answers, what its columns mean, and a function that
 * returns rows — and one page renders any of them while one route exports any
 * of them. Adding the thirty-first is a function, not a screen.
 */

export type Cell = string | number | null;

export interface Column {
  key: string;
  label: string;
  /** Numbers read better right-aligned; everything else does not. */
  numeric?: boolean;
}

export interface ReportResult {
  columns: Column[];
  rows: Cell[][];
  /** A sentence under the table when the rows need one. */
  note?: string;
  /** Headline figures, shown above the table. */
  stats?: { label: string; value: string; sub?: string }[];
}

export interface ReportContext {
  organizationId: string;
  tenantId: string;
  currency: string;
  timeZone: string;
  /** Start of the window, already floored to a local day. */
  since: Date;
  days: number;
}

export const REPORT_CATEGORIES = [
  { key: 'sales', label: 'Sales and enrolment' },
  { key: 'progress', label: 'Batches and progress' },
  { key: 'feedback', label: 'Feedback and rating' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'trainer', label: 'Trainers' },
  { key: 'messaging', label: 'Notifications' },
  { key: 'advanced', label: 'Assessments' },
  { key: 'operations', label: 'Operations' },
] as const;

export type CategoryKey = (typeof REPORT_CATEGORIES)[number]['key'];

/**
 * Which permission a category answers to.
 *
 * Gating every report on one key would mean a branch manager who may see
 * trainer load also sees collections. The catalogue filters itself to what the
 * person can actually open, so nobody is offered a door that refuses them.
 */
export const CATEGORY_PERMISSIONS: Record<CategoryKey, string> = {
  sales: 'reports.sales_reports',
  progress: 'reports.batch_reports',
  feedback: 'reports.feedback_reports',
  marketing: 'reports.sales_reports',
  trainer: 'reports.trainer_reports',
  messaging: 'reports.notification_logs',
  advanced: 'analytics.test_analytics',
  operations: 'analytics.manage_analytics',
};

export interface ReportDef {
  id: string;
  title: string;
  category: CategoryKey;
  /** The question this report answers, in the words somebody would ask it. */
  question: string;
  /** Every column that could be misread, spelled out. */
  definitions: [string, string][];
  /** Reports that ignore the date range say so rather than implying one. */
  ignoresRange?: boolean;
  run(ctx: ReportContext): Promise<ReportResult>;
}
