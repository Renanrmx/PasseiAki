function base64FromBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bytesFromBase64(str) {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBase64String(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) {
    return false;
  }

  let paddingStarted = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isAlphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    const isBase64Symbol = code === 43 || code === 47;
    const isPadding = code === 61;

    if (isPadding) {
      paddingStarted = true;
      continue;
    }
    if (paddingStarted || (!isAlphaNumeric && !isBase64Symbol)) {
      return false;
    }
  }

  return true;
}

function decodeBase64Field(envelope, field, expectedLength) {
  const value = envelope[field];
  if (!isBase64String(value)) {
    throw new Error(`Invalid backup envelope field: ${field}`);
  }

  let bytes;
  try {
    bytes = bytesFromBase64(value);
  } catch (error) {
    throw new Error(`Invalid backup envelope field: ${field}`);
  }

  if (typeof expectedLength === "number" && bytes.length !== expectedLength) {
    throw new Error(`Invalid backup envelope field: ${field}`);
  }

  return bytes;
}

function validateBackupEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    throw new Error("Invalid backup envelope");
  }
  if (envelope.v !== 1) {
    throw new Error("Unsupported backup envelope version");
  }

  const salt = decodeBase64Field(envelope, "salt", 16);
  const nonce = decodeBase64Field(envelope, "nonce", 12);
  if (!isBase64String(envelope.data)) {
    throw new Error("Invalid backup envelope field: data");
  }

  return { salt, nonce };
}

function randomBytes(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

function ensureCryptoLibs() {
  const urlFor = (path) => (typeof api !== "undefined" && api.runtime?.getURL ? api.runtime.getURL(path) : path);

  if (typeof ChaCha20Poly1305 === "undefined" && typeof importScripts === "function") {
    try {
      importScripts(urlFor("vendor/chacha20poly1305.js"));
    } catch (error) {
      console.warn("Failed to import ChaCha20Poly1305:", error);
    }
  }
  if (typeof argon2 === "undefined" && typeof importScripts === "function") {
    try {
      importScripts(urlFor("vendor/argon2-bundled.min.js"));
    } catch (error) {
      console.warn("Failed to import argon2:", error);
    }
  }

  if (typeof ChaCha20Poly1305 === "undefined") {
    console.warn("ChaCha20Poly1305 not loaded in background context");
  }
  if (typeof argon2 === "undefined") {
    console.warn("Argon2 not loaded in background context");
  }
}

async function deriveKeyFromPassword(password, salt) {
  ensureCryptoLibs();
  if (typeof argon2 === "undefined" || !argon2.hash) {
    throw new Error("Argon2 not loaded");
  }
  const res = await argon2.hash({
    pass: password,
    salt,
    hashLen: 32,
    time: 3,
    mem: 65536,
    parallelism: 1,
    type: argon2.ArgonType.Argon2id
  });
  return res.hash instanceof Uint8Array ? res.hash : new Uint8Array(res.hash);
}

async function encryptWithPassword(password, plaintextBytes) {
  ensureCryptoLibs();
  if (typeof ChaCha20Poly1305 === "undefined") {
    throw new Error("ChaCha20Poly1305 not loaded");
  }
  const salt = randomBytes(16);
  const key = await deriveKeyFromPassword(password, salt);
  const nonce = randomBytes(12);
  const cipher = new ChaCha20Poly1305.ChaCha20Poly1305(key);
  const ciphertext = cipher.seal(nonce, plaintextBytes);
  return {
    v: 1, // envelope version, update if encryption changes
    salt: base64FromBytes(salt),
    nonce: base64FromBytes(nonce),
    data: base64FromBytes(ciphertext)
  };
}

async function decryptWithPassword(password, envelope) {
  const validated = validateBackupEnvelope(envelope);
  ensureCryptoLibs();
  if (typeof ChaCha20Poly1305 === "undefined") {
    throw new Error("ChaCha20Poly1305 not loaded");
  }

  const { salt, nonce } = validated;
  const data = bytesFromBase64(envelope.data);
  if (!salt || !nonce || !data || data.length < 16) {
    throw new Error("Invalid envelope");
  }
  const key = await deriveKeyFromPassword(password, salt);
  const cipher = new ChaCha20Poly1305.ChaCha20Poly1305(key);
  const plaintext = cipher.open(nonce, data);
  if (!plaintext) {
    throw new Error(i18n("restoreIncorrectPasswordOrInvalidFile"));
  }
  return plaintext;
}
