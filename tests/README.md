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

## What is not tested yet, and should be

Anything that needs the database: fulfilment, the drain, entitlement, the
curriculum gate. Those are the highest-value tests in the product and they need
a throwaway Postgres to run against, which is the next piece of work rather than
something to fake with mocks. A mocked fulfilment test proves the mock works.
