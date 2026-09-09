/**
 * Communities, and the one attached to a course.
 *
 * A per-course discussion is a community whose slug is derived from the course's
 * product id. That keeps one table doing one job — a post is a post, whether it
 * sits in a general room or under a course — and the id never changes, so the
 * link cannot break the way a slug-derived one would when somebody renames a
 * course.
 */

export function courseCommunitySlug(productId: string): string {
  return `course-${productId}`;
}

export function productIdOfCourseCommunity(slug: string): string | null {
  return slug.startsWith('course-') ? slug.slice('course-'.length) : null;
}

export const VISIBILITY = [
  { value: 'PUBLIC', label: 'Anyone signed in', hint: 'Every learner on the site can read and post.' },
  { value: 'ENROLLED', label: 'Enrolled learners', hint: 'Only people enrolled in something.' },
  { value: 'INVITE', label: 'Staff only', hint: 'Nothing appears for learners.' },
] as const;

/**
 * Plain text in, safe HTML out.
 *
 * Posts are written by learners, so nothing they type is treated as markup. The
 * only thing we add is paragraph breaks, because a wall of text is unreadable
 * and asking people to write HTML is worse than both.
 */
export function toSafeHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

/** Back to something a textarea can hold, for editing and for search. */
export function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}
