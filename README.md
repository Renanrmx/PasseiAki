# Passei Aki

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/passei-aki/cjgkgmcaogogknnaflonleghgegpcjop)

[Install from Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/passei-aki)

Browser extension that indicates whether an address has already been visited and when. It is especially useful for people who do a lot of research and do not want to get lost among so many links.

On pages, links that have already been accessed at some point are marked in green.

The extension icon changes to green to indicate that the address has already been accessed at some point (it is recommended to keep the extension always visible to make this change easier to see). By clicking the extension, you can see when it was last accessed and how many times it was accessed.

For similar addresses that only change some parameters, the icon changes to purple. When clicking the extension, it displays the latest accesses to addresses that match some parameters when compared with the current tab's address. These parameters are shown in different colors to make viewing and comparison easier.

The history is stored in a secure local database with no data collection. The user can choose in the settings whether to keep saved addresses in plain text or as hashes. Choosing anonymization makes it even safer by preventing someone from viewing the links, while still keeping the main functionality of indicating when an address has already been accessed.

## Secondary features
- List of the latest accessed addresses with date and time (this feature is limited if the extension is configured to anonymize data).
- Site mirrors: allows grouping equivalent sites so they share the same access history.
- Full and partial match exceptions to ignore specific sites during comparisons.
- Full backup of accesses and settings, with the option to create a password-protected file or a readable file without a password.
- Backup restoration with the option to merge accesses or replace the current data.
- Export non-anonymized addresses in table format (CSV) with access dates or in text format (TXT) with addresses only.
- Import addresses from a text file, with one URL per line. External dates are not accepted; imported accesses receive the import date to preserve database integrity.
- Download badge: can indicate when a download link has already been accessed before.

## Persistence and privacy
- Records are saved only locally, normally in IndexedDB.
- If the browser blocks persistent storage, the extension uses in-memory storage with `Map()`. In this mode, the popup displays a warning because the data will be lost when the application closes.
- URLs are normalized and split into `host`, `path`, `query`, and `fragment`. The initial `www.` prefix is ignored globally.
- When anonymization is enabled in the settings, URL parts are saved as HMAC-SHA512 with a local pepper. When disabled, they remain readable to allow history, search, import, and export.
- Password backup: `.bak` envelope in JSON encrypted with Argon2id + ChaCha20-Poly1305. The password is defined when the backup is created and required when restoring.
- Backup without password: readable JSON `.bak` envelope, automatically detected during restoration and validated before processing.

## Run from source
1. Install dependencies: `npm install`.
2. Firefox (MV2 by default): `npm start` (clones `src` to `dist`, copies `manifest.firefox.json` to `dist/manifest.json`, and runs `web-ext run` from `dist`).
3. Chrome/Chromium or Firefox MV3: generate `dist` and use `manifest.chrome.json` as `dist/manifest.json` (`npm run build:chrome` or manual adjustment), then load it in unpacked mode.

## Build
1. Install dependencies: `npm install`.
2. Create the build for Firefox (`npm run build:firefox`) or Chrome (`npm run build:chrome`). The build commands run `npm test` before generating the package.

## Tests and lint

- `npm test`: runs the suite with `node:test`.
- `npm run lint`: prepares the Firefox build, runs `web-ext lint`, and validates Chrome manifest references.

## Technical documentation

The technical documentation for project maintenance and evolution is in `docs/`:

- [Extension architecture](docs/en-us/architecture.md)
- [Persistence, privacy, and data model](docs/en-us/persistence-and-data-model.md)
- [Matching, mirrors, and domain normalization](docs/en-us/matching-and-mirrors.md)
- [Backup, restoration, import, and export](docs/en-us/backup-import-export.md)
- [Tests, lint, and build](docs/en-us/testing-build.md)

For simple UI changes, start with [Extension architecture](docs/en-us/architecture.md) and [Tests, lint, and build](docs/en-us/testing-build.md).

For changes involving history, migrations, backup, mirrors, or anonymization, read these first:

- [Persistence, privacy, and data model](docs/en-us/persistence-and-data-model.md)
- [Matching, mirrors, and domain normalization](docs/en-us/matching-and-mirrors.md)
- [Backup, restoration, import, and export](docs/en-us/backup-import-export.md)

These areas directly affect user data. The rule of thumb is to plan everything before writing, avoid mixing anonymized and readable data, and validate with `npm test`.

## Permissions
- storage: Used for the extension's local storage and auxiliary preferences.
- tabs: Used to read the active tab URL and update the extension icon and state according to the visited page. It is also used to listen to tab events (`onUpdated`, `onActivated`, `onRemoved`), keeping the internal state synchronized with navigation.
- activeTab: Grants temporary access to the active tab after explicit user interaction, allowing one-off reading of the current URL.
- webNavigation: Used to observe navigation and redirects in the main frame, correctly recording initial and final URLs.
- downloads: Used for manual export of backups and `.csv`/`.txt` files, and to detect downloads created by the browser in order to mark/recognize download links that have already been accessed.
- Access to `http://*/*` and `https://*/*`: required for the content script to analyze links on visited pages and for the background script to compare accessed URLs.
