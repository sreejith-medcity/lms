# Tests

```
npm test
```

No framework. Node 22 runs TypeScript and has a test runner built in, so this
needs nothing that is not already installed. `resolve.mjs` teaches it two
conventions from `tsconfig.json`: the `@/` alias, and imports written without a
file extension.

The script passes `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`. Without it
Node prints a paragraph about module type for every `.ts` file it loads, which
buries the actual results. The alternative, declaring the whole package as an ES
module, would change how Next and its config files are loaded, which is not a
trade worth making for tidier output.

CI runs the same two commands on every push and pull request, in
`.github/workflows/check.yml`. It is not a deploy gate, because Hostinger builds
from the branch directly; it is the thing that tells you a push was wrong
without waiting to hear it from a learner.

## What is tested, and why these

Everything here is logic that is pure, decides something consequential, and
would fail quietly rather than loudly.

- **`paths`** — the migration's one irreversible step. A path map with holes in
  it is lost rankings, and the holes come from `/Courses/IELTS/` and
  `/courses/ielts` not being recognised as one page.
- **`pricing`** — the wallet is only as honest as the segment count. One
  Malayalam character turns a 160 character SMS into two messages, and a wallet
  that misses that drains three times faster than the screen says.
- **`providers`** — whether a failure is worth retrying. Backwards either way
  costs money or gives up on a provider that was down for ten seconds.
- **`secrets`** — every gateway key and two-factor secret goes through it.
- **`totp`** — two factor that accepts a wrong code, or rejects a right one,
  locks people out of their own product.
- **`render`** — the rule that stops "Hi ," reaching four hundred people.
- **`clock`** — a 7pm class in Kochi belongs to that Tuesday wherever the server
  is. Every test names a timezone, so none of them pass by accident on a laptop
  set to IST.
- **`tenant-isolation`** — not a unit test but a check over the whole codebase.
  Every query against a table that carries `organizationId` must name it, be
  pinned to a primary key, be built from a variable that names it, or carry a
  written `// tenant-safe:` note. The worst bug this product can have is one
  academy seeing another's learners, and it is invisible while there is only one
  academy in the database.

- **`build-safety`** — the three mistakes that have actually broken this
  project: a directive that drifted below an import and took a deploy down, a
  non-async export from a `'use server'` file that published an array as an
  endpoint, and a client component that could pull the key-unsealing module into
  the browser bundle. None of these are things a type system can see.

Both audits test their own detectors against deliberately broken input as well
as against the codebase. An audit that reports nothing is either a clean
codebase or a broken check, and from the outside those look identical.

## What is not tested yet, and should be

Anything that needs the database: fulfilment, the drain, entitlement, the
curriculum gate. Those are the highest-value tests in the product.

They need a throwaway Postgres, and there is a specific obstacle. Prisma
downloads its query engine from `binaries.prisma.sh`, which is blocked by policy
in the sandbox these were written in, so a Prisma client cannot be generated
there and the tests could be written but never run. Shipping tests nobody has
executed is worse than shipping none, so they are not here yet.

On a machine with a working `prisma generate` the path is short: a Neon branch
or a local Postgres, `TEST_DATABASE_URL` pointing at it, `prisma db push`, and a
harness that truncates between tests. The first four worth writing are the money
ones: that fulfilment is idempotent under a replayed webhook, that an amount
mismatch grants nothing, that a refund expires access without deleting progress,
and that a promo code capped at fifty cannot be claimed fifty-one times.
