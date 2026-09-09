import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const root = resolvePath(fileURLToPath(import.meta.url), '../..');

/** The candidates a bare specifier could mean, in the order TypeScript tries. */
function candidates(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
}

export function resolve(specifier, context, next) {
  let target = null;

  if (specifier.startsWith('@/')) {
    target = resolvePath(root, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    target = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (target) {
    for (const candidate of candidates(target)) {
      if (existsSync(candidate) && !candidate.endsWith('/')) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }

  return next(specifier, context);
}
