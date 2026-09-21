import { existsSync, readFileSync } from 'node:fs';

/**
 * The commit this build was made from, read from the checkout at build
 * time. Hostinger builds from the branch and sets no variable for it, so
 * `.git/HEAD` is followed by hand. `/api/version` serves it, which is how
 * the smoke run after a push knows the new build is the one answering.
 */
function buildSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    const head = readFileSync('.git/HEAD', 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    if (existsSync(`.git/${ref}`)) return readFileSync(`.git/${ref}`, 'utf8').trim();
    const packed = existsSync('.git/packed-refs') ? readFileSync('.git/packed-refs', 'utf8') : '';
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0] : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
  },
};
export default nextConfig;
