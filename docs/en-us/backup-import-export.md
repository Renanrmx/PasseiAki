# Backup, restoration, import, and export

This documentation covers flows that move data into or out of the extension.

## Full backup

Implemented in `src/worker/background.backup.js`.

The payload contains:

- `version`
- `visits`
- `meta`
- `partialExceptions`
- `matchExceptions`
- `mirrorGroups`

Password backups use encrypted envelope version 1:

```json
{
  "v": 1,
  "salt": "...",
  "nonce": "...",
  "data": "..."
}
```

Backups without a password use an explicit envelope, also version 1:

```json
{
  "v": 1,
  "type": "passei-aki-backup",
  "encrypted": false,
  "createdAt": 1234567890,
  "payload": {}
}
```

The payload without a password is intentionally readable.

## Backup encryption

Implemented in `src/worker/background.crypto.js`.

Components:

- Argon2id for key derivation;
- ChaCha20-Poly1305 for authenticated encryption;
- 16-byte salt;
- 12-byte nonce.

Restoring an encrypted backup requires the correct password. Backup without a password is detected automatically and should not ask for a password.

## Validation before restoring

Before restoring, the payload goes through structural validation:

- `visits` and `meta` must be arrays;
- visits need essential fields;
- `queryParamsHash` must be an array of strings;
- `meta.value` only accepts `string`, `number`, `boolean`, or `null`;
- `mirrorGroups` is normalized/rejected through mirror validation.

Do not process a raw payload without validation.

## Restore with merge

When restoring with merge:

- existing readable records can be merged by ID;
- `visitCount` is summed;
- `lastVisited` keeps the largest value;
- `download` uses OR;
- preferences/settings come from the backup according to the current flow.

After writing restored data, the global `www.` migration must be forced to normalize old backups.

## Address import

Implemented in `src/worker/background.import.js`.

Expected input: text with one URL/address per line.

Behavior:

- empty lines are ignored;
- URL without protocol receives `https://`;
- each URL goes through `computeFingerprint`;
- duplicates in the same plan are deduplicated;
- the real import ignores records that already exist in the database.

Import does not preserve external dates by design. The date used is the import date.

## Export

Implemented in `src/worker/background.export.js`.

Exports only readable records (`hashed === false`):

- CSV with address, last access, count, and type;
- TXT with one URL per line.

Anonymized records cannot be exported as readable addresses.
