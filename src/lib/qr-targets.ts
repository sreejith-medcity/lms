/**
 * What a poster's code may open: a handful of the site's own doors by
 * name, or any path on the academy's own host. Never another site, so a
 * printed code with the academy's mark on it cannot lead somewhere else.
 */
export const POSTER_TARGETS: { key: string; label: string; path: string; heading: string; line: string }[] = [
  { key: 'signup', label: 'Sign up', path: '/signup', heading: 'Join us', line: 'Scan to create your learner account.' },
  { key: 'enquire', label: 'Enquire', path: '/contact', heading: 'Ask us anything', line: 'Scan to send an enquiry; we call back the same day.' },
  { key: 'courses', label: 'All courses', path: '/courses', heading: 'Our courses', line: 'Scan to see every course, with dates and fees.' },
  { key: 'login', label: 'Learner sign-in', path: '/login', heading: 'Sign in to learn', line: 'Scan to open your classes, lessons and fees.' },
  { key: 'rewards', label: 'Claim a voucher', path: '/learn/rewards', heading: 'Got a voucher?', line: 'Scan, then type the code on it to make it yours.' },
  { key: 'path', label: 'Another page on this site', path: '', heading: '', line: '' },
];

export interface PosterTarget {
  url: string;
  heading: string;
  line: string;
  slug: string;
}

export function posterTarget(host: string, given: { to: string; path: string; heading: string; line: string }): PosterTarget | null {
  const hostname = host.split(':')[0].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  const preset = POSTER_TARGETS.find((t) => t.key === given.to);
  if (!preset) return null;
  let path = preset.path;
  if (preset.key === 'path') {
    const p = given.path.trim();
    // A path on this site only: it must start with one slash, and carry no
    // scheme, host or protocol-relative trick.
    if (!/^\/(?!\/)[^\s\\]*$/.test(p) || /^\/\/|[@\r\n]/.test(p)) return null;
    path = p;
  }
  const heading = given.heading.trim().slice(0, 80) || preset.heading || 'Scan me';
  const line = given.line.trim().slice(0, 160) || preset.line;
  const slug = (preset.key === 'path' ? path : preset.key).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'page';
  return { url: `https://${hostname}${path}`, heading, line, slug };
}
