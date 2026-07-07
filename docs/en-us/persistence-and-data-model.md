# Persistence, privacy, and data model

The user's history is stored locally. No data is sent to a server.

## IndexedDB and in-memory fallback

The main storage is IndexedDB, implemented in `src/worker/background.database.js`.

When the browser blocks persistent writes, the project marks the database as blocked and uses in-memory `Map()`:

- `memoryVisits`
- `memoryMeta`
- in-memory stores for exceptions
- `mirrorGroupsMemory` in `background.mirrors.js`

This fallback is temporary. The data is lost when the application/extension process closes.

The main popup queries `GET_PERSISTENCE_STATUS` and shows a warning when `memoryOnly === true`.

## Main stores

IndexedDB stores:

- `visits`: access records.
- `meta`: settings, pepper, and aggregate totals.
- `partial_exceptions`: partial match exceptions.
- `match_exceptions`: full match exceptions.
- `mirror_groups`: mirror/alias groups.

## Visit record

Relevant fields:

- `id`: unique record identity.
- `hostHash`, `pathHash`, `queryHash`, `fragmentHash`: keys used in search/match.
- `queryParamsHash`: list of normalized/hashed parameters.
- `hashed`: when different from `false`, the record is treated as anonymized.
- `host`, `path`, `query`, `fragment`: readable fields when available.
- `lastVisited`: timestamp of the latest access.
- `visitCount`: number of accesses.
- `download`: indicates access originated from a download.

## Readable vs anonymized mode

When anonymization is disabled, the record keeps `host`, `path`, `query`, and `fragment` readable.

When it is enabled, the parts used for identity are HMAC-SHA512 with local pepper. The pepper is in `meta`.

Critical rule: do not merge anonymized and non-anonymized records in the same operation. If there is a collision between privacy models, the operation must preserve the original data or abort.

## Aggregate totals

Totals are stored in `meta`:

- `statsTotalEntries`
- `statsTotalVisits`

Operations that add, replace, or remove visits must update these totals or rebuild them.

## Migrations

Important migrations are in `background.mirrors.js`:

- mirror canonicalization;
- global `www.` normalization;
- atomic application in the in-memory fallback.

Best practices:

- build a full plan before writing;
- apply IndexedDB in a transaction when possible;
- in the `Map()` fallback, apply first to copies and swap the real state only at the end;
- recalculate totals from the final result;
- preserve old anonymized records without readable `host` when there is not enough information to recalculate identity.
