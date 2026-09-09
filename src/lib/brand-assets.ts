/**
 * The brand files shipped with this build.
 *
 * Committed to the repo rather than uploaded, because artwork that arrives with
 * the code is the one thing that cannot be out of step with it: a fresh
 * deployment, a new tenant on this build, or a wiped storage bucket all still
 * have a logo. Anything an academy uploads later overrides these.
 */

export interface BundledAsset {
  path: string;
  label: string;
  note: string;
}

export const BUNDLED_LOGOS: BundledAsset[] = [
  {
    path: '/brand/logo.png',
    label: 'Medcity LMS, full lockup',
    note: 'The mark and the wordmark. For the site header.',
  },
  {
    path: '/brand/mark.png',
    label: 'The mark on its own',
    note: 'No wordmark. For tight spaces.',
  },
];

export const BUNDLED_ICONS: BundledAsset[] = [
  {
    path: '/brand/icon-purple.png',
    label: 'Amber on purple',
    note: 'Holds its shape on a light home screen and a dark one.',
  },
  {
    path: '/brand/icon-amber.png',
    label: 'Purple on amber',
    note: 'Louder. Disappears against a warm wallpaper.',
  },
];

/** The colour the shipped artwork is drawn in, so the two cannot disagree. */
export const BUNDLED_BRAND_COLOR = '#322046';
