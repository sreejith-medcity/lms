import { salesReports } from './sales';
import { progressReports } from './progress';
import { feedbackReports, marketingReports } from './engagement';
import {
  trainerReports,
  messagingReports,
  assessmentReports,
  operationsReports,
} from './operations';
import { extraReports } from './extra';
import { CATEGORY_PERMISSIONS, REPORT_CATEGORIES, type ReportDef } from './types';

export * from './types';

/**
 * Every report, in one list.
 *
 * The catalogue is the product here: one page renders any of these and one
 * route exports any of them, so a new report is a function rather than a
 * screen, and no report can quietly ship without its definitions.
 */
export const REPORTS: ReportDef[] = [
  ...salesReports,
  ...progressReports,
  ...feedbackReports,
  ...marketingReports,
  ...trainerReports,
  ...messagingReports,
  ...assessmentReports,
  ...operationsReports,
  ...extraReports,
];

export function reportById(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function permissionFor(report: ReportDef): string {
  return CATEGORY_PERMISSIONS[report.category];
}

/** Only the categories this person may actually open. */
export function reportsByCategory(canView: (permission: string) => boolean) {
  return REPORT_CATEGORIES.filter((category) => canView(CATEGORY_PERMISSIONS[category.key]))
    .map((category) => ({
      ...category,
      reports: REPORTS.filter((r) => r.category === category.key),
    }))
    .filter((c) => c.reports.length > 0);
}
