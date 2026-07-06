# Vendor Files

These files are runtime copies used directly by the browser extension because the
project does not currently bundle source from `node_modules`.

- `iro.min.js`: iro.js 5.5.2, used by the settings color picker.
- `argon2-bundled.min.js`: browser-ready Argon2 runtime used for encrypted backups.
- `chacha20poly1305.js`: ChaCha20-Poly1305 runtime used for encrypted backups.

`web-ext lint` may report an `innerHTML` warning for `iro.min.js`; this comes from
the third-party minified color picker internals rather than application code.
