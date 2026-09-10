/**
 * Which image formats the product accepts, kept apart from storage.ts.
 *
 * A file picker is a client component and storage.ts opens with `node:fs`,
 * so importing the list from there would pull the filesystem into a browser
 * bundle. The build-safety audit has a rule for exactly this mistake, and
 * this file is the answer to it: pure data, safe on either side.
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'gif'] as const;

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/gif',
] as const;

/**
 * Written out in full rather than as `image/*`.
 *
 * `image/*` looks equivalent and is not: a file picker matches it against the
 * type the operating system reports, and an OS that has never heard of AVIF
 * reports nothing useful, so the file is greyed out and the person concludes
 * the product does not support it. Naming the extensions as well means the
 * picker can fall back on the name.
 */
export const IMAGE_ACCEPT = [
  ...IMAGE_MIME_TYPES,
  ...IMAGE_EXTENSIONS.map((e) => `.${e}`),
].join(',');
