/** Progress is a plain ratio of completed materials, kept in one place so the
 *  learner portal, the admin lists and the reports never disagree. */
export function percent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export const MATERIAL_LABELS: Record<string, string> = {
  VIDEO: 'Video',
  AUDIO: 'Audio',
  PDF: 'PDF',
  YOUTUBE: 'Video',
  IMAGE: 'Image',
  DOC: 'Document',
  SHEET: 'Spreadsheet',
  SLIDE: 'Slides',
  TEXT_HTML: 'Reading',
  ZIP: 'Download',
  SCORM: 'Interactive',
  LINK_EMBED: 'Link',
  EPUB: 'eBook',
  LIVE_SESSION: 'Live class',
  ASSESSMENT: 'Test',
};
