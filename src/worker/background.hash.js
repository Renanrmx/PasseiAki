function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function ensurePepperKey() {
  if (pepperKeyPromise) {
    return pepperKeyPromise;
  }

  pepperKeyPromise = (async () => {
    const db = await openDatabase();
    const readTx = db.transaction(META_STORE, "readonly");
    const metaStore = readTx.objectStore(META_STORE);
    const stored = await requestToPromise(metaStore.get(META_PEPPER_KEY));
    await waitForTransaction(readTx);

    let rawPepper = stored && stored.value
      ? base64ToBuffer(stored.value)
      : null;

    if (!rawPepper) {
      const generated = crypto.getRandomValues(new Uint8Array(32));
      rawPepper = generated.buffer;
      const writeTx = db.transaction(META_STORE, "readwrite");
      writeTx.objectStore(META_STORE).put({
        key: META_PEPPER_KEY,
        value: bufferToBase64(rawPepper)
      });
      await waitForTransaction(writeTx);
    }

    return crypto.subtle.importKey(
      "raw",
      rawPepper,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
  })();

  return pepperKeyPromise;
}

async function hashValue(value) {
  const key = await ensurePepperKey();
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bufferToHex(signature);
}
