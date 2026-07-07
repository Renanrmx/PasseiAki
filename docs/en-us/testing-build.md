# Tests, lint, and build

## Tests

The project uses `node:test`, with no extra framework dependency.

Command:

```sh
npm test
```

The main file is `test/pure-functions.test.js`.

Tests load the extension's global scripts with `vm`, because the code does not use ES modules. When comparing objects/arrays coming from `vm`, use conversion to a plain object when necessary.

Areas currently covered:

- domain and URL normalization;
- partial match;
- import plan;
- readable export;
- backup validation;
- mirror normalization and migration;
- textual search by aliases;
- global `www.` migration;
- exceptions with aliases;
- readable and anonymized `upsertVisit`;
- fallback in `Map()`.

## Syntax check

For changed JS files:

```sh
node --check path/to/file.js
```

This is useful because many scripts are global and can break extension loading even without a specific test.

## Lint

Command:

```sh
npm run lint
```

It runs:

- `npm run prepare:firefox`
- `web-ext lint --source-dir dist`
- custom validation of Chrome manifest/references

Known warnings:

- compatibility of `strict_min_version` with `data_collection_permissions`;
- `UNSAFE_VAR_ASSIGNMENT` coming from the minified vendor `iro.min.js`.

If the number or type of warnings changes, investigate.

## Build

Commands:

```sh
npm run build:firefox
npm run build:chrome
```

Both run `npm test` before preparing and packaging.

`prepare:*` generates `dist/` by copying `src/` and choosing the correct manifest. Do not edit `dist/` directly.

## Checklist before finishing a change

For a small docs change:

- review diff;
- running the build is not mandatory.

For a JS change:

- `node --check` on changed files;
- `npm test`;
- `npm run lint`.

For a UI/locales change:

- ensure a key in all locales;
- validate locale JSON;
- check that long text does not widen the popup/modal.

For a data/migration/backup change:

- add or update tests;
- validate IndexedDB and `Map()` fallback;
- preserve backup compatibility when applicable;
- do not mix anonymized and readable records.
