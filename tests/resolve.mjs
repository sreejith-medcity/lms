import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Letting the test runner read the app's own imports.
 *
 * Node 22 strips TypeScript types by itself, so no build step and no bundler is
 * needed to run these. What it does not do is understand two conventions this
 * codebase uses: the `@/` alias from tsconfig, and imports written without a
 * file extension. Both are resolved here, in about twenty lines, rather than by
 * adding a test framework and its dependency tree.
 *
 * tsx cannot do this job here because its esbuild binary is built for whichever
 * machine ran the install, and the tests need to run on a laptop and in CI.
 */
register('./resolve-hooks.mjs', pathToFileURL('./tests/'));
