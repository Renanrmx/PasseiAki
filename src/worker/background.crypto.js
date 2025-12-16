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

function randomBytes(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

function ensureCryptoLibs() {
  if (typeof ChaCha20Poly1305 === "undefined" && typeof importScripts === "function") {
    try {
      importScripts("vendor/chacha20poly1305.js");
    } catch (error) {
      // ignore
    }
  }
  if (typeof argon2 === "undefined" && typeof importScripts === "function") {
    try {
      importScripts("vendor/argon2-bundled.min.js");
    } catch (error) {
      // ignore
    }
  }

  if (typeof ChaCha20Poly1305 === "undefined") {
    console.warn("ChaCha20Poly1305 nao carregado no contexto do background");
  }
  if (typeof argon2 === "undefined") {
    console.warn("Argon2 nao carregado no contexto do background");
  }
}

async function deriveKeyFromPassword(password, salt) {
  ensureCryptoLibs();
  if (typeof argon2 === "undefined" || !argon2.hash) {
    throw new Error("Argon2 nao carregado");
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
    throw new Error("ChaCha20Poly1305 nao carregado");
  }
  const salt = randomBytes(16);
  const key = await deriveKeyFromPassword(password, salt);
  const nonce = randomBytes(12);
  const cipher = new ChaCha20Poly1305.ChaCha20Poly1305(key);
  const ciphertext = cipher.seal(nonce, plaintextBytes);
  return {
    v: 1, // versao do envelope, alterar se mudar de criptografia
    salt: base64FromBytes(salt),
    nonce: base64FromBytes(nonce),
    data: base64FromBytes(ciphertext)
  };
}

async function decryptWithPassword(password, envelope) {
  ensureCryptoLibs();
  if (typeof ChaCha20Poly1305 === "undefined") {
    throw new Error("ChaCha20Poly1305 nao carregado");
  }

  const salt = bytesFromBase64(envelope.salt);
  const nonce = bytesFromBase64(envelope.nonce);
  const data = bytesFromBase64(envelope.data);
  if (!salt || !nonce || !data) {
    throw new Error("Envelope invalido");
  }
  const key = await deriveKeyFromPassword(password, salt);
  const cipher = new ChaCha20Poly1305.ChaCha20Poly1305(key);
  const plaintext = cipher.open(nonce, data);
  if (!plaintext) {
    throw new Error("Falha ao restaurar, senha incorreta ou arquivo inválido");
  }
  return plaintext;
}
