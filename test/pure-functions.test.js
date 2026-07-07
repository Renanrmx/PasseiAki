const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const BACKGROUND_CONSTANTS = {
  DB_NAME: "passeiAkiTest",
  DB_VERSION: 3,
  VISITS_STORE: "visits",
  META_STORE: "meta",
  PARTIAL_EXCEPTIONS_STORE: "partial_exceptions",
  MATCH_EXCEPTIONS_STORE: "match_exceptions",
  MIRROR_GROUPS_STORE: "mirror_groups",
  META_PEPPER_KEY: "pepper"
};

function sourcePath(relativePath) {
  return path.join(ROOT, relativePath);
}

function readSource(relativePath) {
  return fs.readFileSync(sourcePath(relativePath), "utf8");
}

function loadExtensionScripts(files, globals = {}) {
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    ...globals
  };

  vm.createContext(sandbox);
  files.forEach((file) => {
    vm.runInContext(readSource(file), sandbox, { filename: sourcePath(file) });
  });
  return sandbox;
}

function loadDataSandbox(files = [], globals = {}) {
  return loadExtensionScripts(
    [
      "src/shared/domains.js",
      "src/shared/records.js",
      "src/worker/background.utils.js",
      ...files
    ],
    {
      ...BACKGROUND_CONSTANTS,
      indexedDB: undefined,
      ...globals
    }
  );
}

function readUpsertVisitSource() {
  const source = readSource("src/worker/background.js");
  const start = source.indexOf("async function upsertVisit(");
  const end = source.indexOf("\nasync function setActionState", start);
  if (start < 0 || end < 0) {
    throw new Error("Unable to locate upsertVisit source");
  }
  return source.slice(start, end);
}

function loadUpsertVisitSandbox(globals = {}) {
  const sandbox = loadDataSandbox(
    ["src/worker/background.mirrors.js"],
    globals
  );
  vm.runInContext(readUpsertVisitSource(), sandbox, {
    filename: `${sourcePath("src/worker/background.js")}#upsertVisit`
  });
  return sandbox;
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createVisit(overrides = {}) {
  return {
    id: "site.com|/p||",
    hostHash: "site.com",
    pathHash: "/p",
    queryHash: "",
    fragmentHash: "",
    queryParamsHash: [],
    hashed: false,
    host: "site.com",
    path: "/p",
    query: "",
    fragment: "",
    lastVisited: 100,
    visitCount: 1,
    ...overrides
  };
}

function createFingerprintFromUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathValue = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const path = pathValue === "" ? "/" : pathValue;
  const query = url.search.replace(/^\?/, "");
  const fragment = url.hash.replace(/^#/, "");
  const params = query ? query.split("&").filter(Boolean).sort() : [];
  const id = `${host}|${path}|${query}|${fragment}`;

  return {
    id,
    ids: { plain: id, hash: `hash:${id}` },
    storedHashed: false,
    keys: {
      plain: { host, path, query, fragment, params },
      hash: {
        host: `hash:${host}`,
        path: `hash:${path}`,
        query: `hash:${query}`,
        fragment: `hash:${fragment}`,
        params: params.map((param) => `hash:${param}`)
      }
    },
    parts: { host, path, query, fragment }
  };
}

function countVisitStats(records) {
  return records.reduce(
    (totals, record) => {
      if (!record || !record.id) {
        return totals;
      }
      return {
        totalEntries: totals.totalEntries + 1,
        totalVisits: totals.totalVisits + (Number.isFinite(record.visitCount) ? record.visitCount : 0)
      };
    },
    { totalEntries: 0, totalVisits: 0 }
  );
}

function readMemoryState(sandbox) {
  return toPlain(vm.runInContext(
    `({
      visits: Array.from(memoryVisits.values()),
      meta: Array.from(memoryMeta.values()),
      mirrorGroups: Array.from(mirrorGroupsMemory.values())
    })`,
    sandbox
  ));
}

function seedMemoryVisits(sandbox, visits) {
  sandbox.__seedVisits = visits;
  vm.runInContext(
    `dbWriteBlocked = true;
    memoryVisits.clear();
    __seedVisits.forEach((record) => memoryVisits.set(record.id, record));`,
    sandbox
  );
  delete sandbox.__seedVisits;
}

test("normaliza entrada de dominio removendo protocolo, caminho, porta e www inicial", () => {
  const sandbox = loadExtensionScripts(["src/shared/domains.js"]);

  assert.equal(
    sandbox.AkiDomains.extractDomainInput("https://www.site-a.com:8443/pagina?search=test#main"),
    "www.site-a.com"
  );
  assert.equal(
    sandbox.AkiDomains.normalizeDomainInput("https://www.site-a.com:8443/pagina?search=test#main"),
    "site-a.com"
  );
  assert.equal(sandbox.AkiDomains.normalizeDomainInput("BLOG.Site-A.com."), "blog.site-a.com");
  assert.equal(sandbox.AkiDomains.sanitizeTypedDomainInput("Site-A.com/path?x=1#main"), "site-a.compathx1main");
});

test("normaliza partes de URL usadas no fingerprint", () => {
  const sandbox = loadExtensionScripts([
    "src/shared/domains.js",
    "src/worker/background.utils.js"
  ]);

  const parts = sandbox.normalizeUrlParts("https://WWW.Example.com/Foo/?b=2&a=1&a=0#Main");
  assert.deepEqual(toPlain(parts), {
    host: "example.com",
    path: "/foo",
    query: "a=0&a=1&b=2",
    queryEntries: ["a=0", "a=1", "b=2"],
    fragment: "Main"
  });
  assert.equal(sandbox.normalizeUrlParts("ftp://example.com/file"), null);
  assert.equal(sandbox.getHostFromInput("https://www.site.com:8080/path?a=1"), "site.com");
});

test("detecta match parcial por parametros, fragmento e candidatos de alias", () => {
  const sandbox = loadExtensionScripts(["src/worker/background.match.js"]);
  const record = {
    id: "site-a.com|/produto|a=1|top",
    hashed: false,
    hostHash: "site-a.com",
    pathHash: "/produto",
    queryHash: "a=1",
    fragmentHash: "top",
    queryParamsHash: ["a=1"]
  };

  assert.equal(
    sandbox.isPartialMatch(record, {
      keys: {
        plain: {
          host: "site-a.com",
          path: "/produto",
          query: "a=1&b=2",
          fragment: "top",
          params: ["a=1", "b=2"]
        }
      }
    }),
    true
  );
  assert.equal(
    sandbox.isPartialMatch(record, {
      keys: {
        plain: {
          host: "site-a.com",
          path: "/produto",
          query: "a=1",
          fragment: "top",
          params: ["a=1"]
        }
      }
    }),
    false
  );
  assert.equal(
    sandbox.isPartialMatch(
      {
        ...record,
        id: "site-b.com|/produto||old",
        hostHash: "site-b.com",
        queryHash: "",
        fragmentHash: "old",
        queryParamsHash: []
      },
      {
        keys: {
          plain: {
            host: "site-a.com",
            path: "/produto",
            query: "",
            fragment: "new",
            params: []
          }
        },
        candidateHosts: { plain: ["site-a.com", "site-b.com"] }
      }
    ),
    true
  );
});

test("buildImportPlan normaliza linhas, conta invalidas e deduplica registros planejados", async () => {
  const sandbox = loadExtensionScripts(
    ["src/worker/background.import.js"],
    { computeFingerprint: async (urlString) => createFingerprintFromUrl(urlString) }
  );

  const plan = await sandbox.buildImportPlan([
    "example.com/A",
    "https://www.example.com/A",
    "not a url"
  ].join("\n"));

  assert.equal(plan.total, 3);
  assert.equal(plan.valid, 2);
  assert.equal(plan.invalid, 1);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].id, "example.com|/a||");
  assert.equal(plan.records[0].host, "example.com");
  assert.equal(plan.records[0].path, "/a");
});

test("exportacao filtra apenas registros legiveis e escapa CSV", () => {
  const sandbox = loadExtensionScripts(["src/worker/background.export.js"]);

  assert.equal(sandbox.csvEscape('site.com/"produto";teste'), '"site.com/""produto"";teste"');
  assert.equal(sandbox.shouldExportPlainVisit({ hashed: false }, true, false), true);
  assert.equal(sandbox.shouldExportPlainVisit({ hashed: true }, true, true), false);
  assert.equal(sandbox.shouldExportPlainVisit({ hashed: false, download: true }, true, false), false);
  assert.equal(sandbox.shouldExportPlainVisit({ hashed: false, download: true }, false, true), true);
});

test("backup valida payload, envelope sem senha e mirrorGroups opcionais", () => {
  const sandbox = loadExtensionScripts(
    [
      "src/shared/domains.js",
      "src/worker/background.utils.js",
      "src/worker/background.mirrors.js",
      "src/worker/background.backup.js"
    ],
    {
      isPlainObject: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
      hashValue: async (value) => `hash:${value}`,
      getAllVisits: async () => [],
      countVisitStats
    }
  );

  const payload = {
    version: 2,
    visits: [
      createVisit({
        id: "site-a.com|/produto|x=1|main",
        hostHash: "site-a.com",
        pathHash: "/produto",
        queryHash: "x=1",
        fragmentHash: "main",
        queryParamsHash: ["x=1"],
        host: "site-a.com",
        path: "/produto",
        query: "x=1",
        fragment: "main",
        visitCount: 2,
        lastVisited: 123
      })
    ],
    meta: [{ key: "encryptionEnabled", value: false }],
    partialExceptions: ["partial.example.com"],
    matchExceptions: ["full.example.com"],
    mirrorGroups: [["https://www.site-a.com/path", "site-b.com"]]
  };

  const validated = sandbox.validateBackupPayload(payload);
  assert.equal(validated.version, 2);
  assert.deepEqual(toPlain(validated.mirrorGroups), [
    { canonical: "site-a.com", aliases: ["site-b.com"] }
  ]);
  assert.deepEqual(toPlain(sandbox.validateBackupPayload({ ...payload, mirrorGroups: undefined }).mirrorGroups), []);

  const envelope = {
    v: 1,
    type: "passei-aki-backup",
    encrypted: false,
    createdAt: 456,
    payload
  };
  assert.equal(sandbox.isPlainBackupEnvelope(envelope), true);
  assert.equal(sandbox.validatePlainBackupEnvelope(envelope).visits[0].visitCount, 2);
  assert.throws(
    () => sandbox.validateBackupPayload({ ...payload, meta: [{ key: "bad", value: { nested: true } }] }),
    /Invalid backup meta/
  );
});

test("normaliza grupos de aliases e rejeita dominio duplicado entre grupos", () => {
  const sandbox = loadExtensionScripts([
    "src/shared/domains.js",
    "src/worker/background.utils.js",
    "src/worker/background.mirrors.js"
  ]);

  assert.deepEqual(toPlain(sandbox.normalizeMirrorGroups([
    ["https://www.site-a.com/path", "site-a.com", "site-b.com"],
    { canonical: "app.site-a.com", aliases: ["blog.site-a.com"] }
  ])), [
    { canonical: "site-a.com", aliases: ["site-b.com"] },
    { canonical: "app.site-a.com", aliases: ["blog.site-a.com"] }
  ]);

  assert.throws(
    () => sandbox.normalizeMirrorGroups([["site-a.com", "site-b.com"], ["site-b.com", "site-c.com"]]),
    /mirrorDomainDuplicated/
  );
});

test("migra aliases antigos sem perder contagem, data, download e parametros", async () => {
  const visits = [
    createVisit({
      id: "site-a.com|/p||",
      hostHash: "site-a.com",
      host: "site-a.com",
      visitCount: 2,
      lastVisited: 100,
      queryParamsHash: ["a=1"]
    }),
    createVisit({
      id: "site-b.com|/p||",
      hostHash: "site-b.com",
      host: "site-b.com",
      visitCount: 3,
      lastVisited: 200,
      download: true,
      queryParamsHash: ["b=2"]
    })
  ];
  const sandbox = loadExtensionScripts(
    [
      "src/shared/domains.js",
      "src/worker/background.utils.js",
      "src/worker/background.mirrors.js"
    ],
    {
      getAllVisits: async () => visits,
      hashValue: async (value) => `hash:${value}`,
      countVisitStats
    }
  );
  const groups = sandbox.normalizeMirrorGroups([["site-a.com", "site-b.com"]]);

  const migration = await sandbox.buildMirrorMigrationPlan(groups);
  const records = toPlain(migration.upsertRecords);

  assert.deepEqual(toPlain(migration.deleteIds), ["site-a.com|/p||", "site-b.com|/p||"]);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "site-a.com|/p||");
  assert.equal(records[0].visitCount, 5);
  assert.equal(records[0].lastVisited, 200);
  assert.equal(records[0].download, true);
  assert.deepEqual(records[0].queryParamsHash, ["a=1", "b=2"]);
  assert.deepEqual(toPlain(migration.totals), { totalEntries: 1, totalVisits: 5 });
});

test("busca textual amplia superficie pesquisavel para aliases", () => {
  const sandbox = loadExtensionScripts([
    "src/shared/domains.js",
    "src/shared/records.js",
    "src/worker/background.utils.js",
    "src/worker/background.mirrors.js"
  ]);
  const groups = sandbox.normalizeMirrorGroups([["site-a.com", "site-b.com"]]);
  const index = sandbox.buildMirrorSearchIndex(groups);

  const addresses = sandbox.buildMirrorSearchAddresses(
    createVisit({
      id: "site-a.com|/produto|x=1|main",
      hostHash: "site-a.com",
      host: "site-a.com",
      path: "/produto",
      query: "x=1",
      fragment: "main"
    }),
    index
  );

  assert.deepEqual(toPlain(addresses), [
    "site-a.com/produto?x=1#main",
    "site-b.com/produto?x=1#main"
  ]);
  assert.equal(addresses.some((address) => address.includes("e-b.com/pro")), true);
});

test("migração global de www mescla duplicatas e preserva anonimizados sem host legivel", async () => {
  const visits = [
    createVisit({
      id: "www.site.com|/p||",
      hostHash: "www.site.com",
      host: "www.site.com",
      visitCount: 3,
      lastVisited: 300,
      queryParamsHash: ["a=1"]
    }),
    createVisit({
      id: "site.com|/p||",
      hostHash: "site.com",
      host: "site.com",
      visitCount: 2,
      lastVisited: 100,
      download: true,
      queryParamsHash: ["b=2"]
    }),
    createVisit({
      id: "hash:www.secure.com|hash:/download|hash:q=1|hash:frag",
      hostHash: "hash:www.secure.com",
      pathHash: "hash:/download",
      queryHash: "hash:q=1",
      fragmentHash: "hash:frag",
      queryParamsHash: ["hash:q=1"],
      hashed: true,
      host: "www.secure.com",
      path: "",
      query: "",
      fragment: "",
      visitCount: 4,
      lastVisited: 400
    }),
    createVisit({
      id: "legacy-host-hash|hash:/secret||",
      hostHash: "legacy-host-hash",
      pathHash: "hash:/secret",
      queryHash: "",
      fragmentHash: "",
      queryParamsHash: [],
      hashed: true,
      host: "",
      path: "",
      query: "",
      fragment: "",
      visitCount: 7,
      lastVisited: 50
    })
  ];
  const sandbox = loadDataSandbox(
    ["src/worker/background.mirrors.js"],
    {
      getAllVisits: async () => visits,
      hashValue: async (value) => `hash:${value}`,
      countVisitStats
    }
  );

  const migration = await sandbox.buildWwwNormalizationMigrationPlan();
  const records = toPlain(migration.upsertRecords);
  const plain = records.find((record) => record.id === "site.com|/p||");
  const hashed = records.find((record) => record.id === "hash:secure.com|hash:/download|hash:q=1|hash:frag");

  assert.deepEqual(toPlain(migration.deleteIds).sort(), [
    "hash:www.secure.com|hash:/download|hash:q=1|hash:frag",
    "site.com|/p||",
    "www.site.com|/p||"
  ].sort());
  assert.equal(plain.host, "site.com");
  assert.equal(plain.visitCount, 5);
  assert.equal(plain.lastVisited, 300);
  assert.equal(plain.download, true);
  assert.deepEqual(plain.queryParamsHash, ["b=2", "a=1"]);
  assert.equal(hashed.host, "secure.com");
  assert.equal(hashed.hostHash, "hash:secure.com");
  assert.equal(hashed.hashed, true);
  assert.deepEqual(hashed.queryParamsHash, ["hash:q=1"]);
  assert.deepEqual(toPlain(migration.totals), { totalEntries: 3, totalVisits: 16 });
});

test("exceções completas e parciais consideram aliases sem engolir subdominios", async () => {
  const sandbox = loadDataSandbox([
    "src/worker/background.database.js",
    "src/worker/background.mirrors.js"
  ]);

  await sandbox.setMirrorGroups([["site-a.com", "site-b.com"]]);
  await sandbox.setMatchExceptions(["https://www.site-b.com/path"]);
  await sandbox.setPartialExceptions(["site-b.com"]);

  assert.equal(await sandbox.isMatchException("site-a.com"), true);
  assert.equal(await sandbox.isMatchException("site-b.com"), true);
  assert.equal(await sandbox.isMatchException("site-a.com", ["site-a.com", "site-b.com"]), true);
  assert.equal(await sandbox.isPartialException("site-a.com"), true);
  assert.equal(await sandbox.isMatchException("app.site-a.com"), false);
  assert.equal(await sandbox.isPartialException("blog.site-b.com"), false);
});

test("upsertVisit legivel migra aliases existentes, soma visitas e ajusta totais", async () => {
  const canonicalId = "site-a.com|/p|x=2|";
  const aliasId = "site-b.com|/p|x=2|";
  const existing = new Map([
    [canonicalId, createVisit({
      id: canonicalId,
      hostHash: "site-a.com",
      host: "site-a.com",
      path: "/p",
      query: "x=2",
      queryHash: "x=2",
      queryParamsHash: ["x=2"],
      visitCount: 2,
      lastVisited: 300
    })],
    [aliasId, createVisit({
      id: aliasId,
      hostHash: "site-b.com",
      host: "site-b.com",
      path: "/p",
      query: "x=2",
      queryHash: "x=2",
      queryParamsHash: ["b=2"],
      visitCount: 4,
      lastVisited: 100,
      download: true
    })]
  ]);
  const writes = { replace: null, put: null, stats: null, messages: [] };
  const sandbox = loadUpsertVisitSandbox({
    Date: { now: () => 500 },
    MSG: { HISTORY_UPDATED: "HISTORY_UPDATED" },
    hashValue: async (value) => `hash:${value}`,
    computeFingerprint: async () => ({
      id: canonicalId,
      ids: { plain: canonicalId, hash: "hash:site-a.com|hash:/p|hash:x=2|hash:" },
      storedHashed: false,
      candidateIds: {
        plain: [canonicalId, aliasId],
        hash: ["hash:site-a.com|hash:/p|hash:x=2|hash:", "hash:site-b.com|hash:/p|hash:x=2|hash:"]
      },
      keys: {
        plain: { host: "site-a.com", path: "/p", query: "x=2", fragment: "", params: ["x=2"] },
        hash: {
          host: "hash:site-a.com",
          path: "hash:/p",
          query: "hash:x=2",
          fragment: "hash:",
          params: ["hash:x=2"]
        }
      },
      parts: { host: "site-a.com", path: "/p", query: "x=2", fragment: "" }
    }),
    getVisitById: async (id) => existing.get(id) || null,
    replaceVisits: async (deleteIds, records) => {
      writes.replace = { deleteIds, records };
    },
    putVisit: async (record) => {
      writes.put = record;
    },
    adjustStatsTotals: async (entryDelta, visitDelta) => {
      writes.stats = { entryDelta, visitDelta };
    },
    sendRuntimeMessageSafe: (message) => {
      writes.messages.push(message);
    }
  });

  const result = await sandbox.upsertVisit("https://site-b.com/p?x=2");
  const record = toPlain(result.record);

  assert.equal(result.existedBefore, true);
  assert.equal(result.previousLastVisited, 300);
  assert.deepEqual(toPlain(writes.replace.deleteIds), [canonicalId, aliasId]);
  assert.equal(writes.put, null);
  assert.equal(record.id, canonicalId);
  assert.equal(record.host, "site-a.com");
  assert.equal(record.visitCount, 7);
  assert.equal(record.lastVisited, 500);
  assert.equal(record.download, true);
  assert.deepEqual(record.queryParamsHash, ["x=2", "b=2"]);
  assert.deepEqual(writes.stats, { entryDelta: -1, visitDelta: 1 });
  assert.deepEqual(toPlain(writes.messages), [{ type: "HISTORY_UPDATED" }]);
});

test("upsertVisit anonimizado migra alias sem misturar com registros legiveis", async () => {
  const canonicalHashId = "hash:site-a.com|hash:/secure|hash:q=1|hash:frag";
  const aliasHashId = "hash:site-b.com|hash:/secure|hash:q=1|hash:frag";
  const existing = new Map([
    [aliasHashId, createVisit({
      id: aliasHashId,
      hostHash: "hash:site-b.com",
      pathHash: "hash:/secure",
      queryHash: "hash:q=1",
      fragmentHash: "hash:frag",
      queryParamsHash: ["hash:q=1"],
      hashed: true,
      host: "site-b.com",
      path: "",
      query: "",
      fragment: "",
      visitCount: 4,
      lastVisited: 250
    })],
    ["site-b.com|/secure|q=1|frag", createVisit({
      id: "site-b.com|/secure|q=1|frag",
      hostHash: "site-b.com",
      host: "site-b.com",
      path: "/secure",
      query: "q=1",
      fragment: "frag",
      hashed: false,
      visitCount: 9,
      lastVisited: 900
    })]
  ]);
  const writes = { replace: null, stats: null };
  const sandbox = loadUpsertVisitSandbox({
    Date: { now: () => 600 },
    MSG: { HISTORY_UPDATED: "HISTORY_UPDATED" },
    hashValue: async (value) => `hash:${value}`,
    computeFingerprint: async () => ({
      id: canonicalHashId,
      ids: { hash: canonicalHashId, plain: "site-a.com|/secure|q=1|frag" },
      storedHashed: true,
      candidateIds: {
        hash: [canonicalHashId, aliasHashId],
        plain: ["site-a.com|/secure|q=1|frag", "site-b.com|/secure|q=1|frag"]
      },
      keys: {
        hash: {
          host: "hash:site-a.com",
          path: "hash:/secure",
          query: "hash:q=1",
          fragment: "hash:frag",
          params: ["hash:q=1"]
        },
        plain: { host: "site-a.com", path: "/secure", query: "q=1", fragment: "frag", params: ["q=1"] }
      },
      parts: { host: "site-a.com", path: "/secure", query: "q=1", fragment: "frag" }
    }),
    getVisitById: async (id) => existing.get(id) || null,
    replaceVisits: async (deleteIds, records) => {
      writes.replace = { deleteIds, records };
    },
    putVisit: async () => {
      assert.fail("upsertVisit should replace existing hashed alias");
    },
    adjustStatsTotals: async (entryDelta, visitDelta) => {
      writes.stats = { entryDelta, visitDelta };
    },
    sendRuntimeMessageSafe: () => {}
  });

  const result = await sandbox.upsertVisit("https://site-b.com/secure?q=1#frag");
  const record = toPlain(result.record);

  assert.equal(result.existedBefore, true);
  assert.equal(result.previousLastVisited, 250);
  assert.deepEqual(toPlain(writes.replace.deleteIds), [aliasHashId]);
  assert.equal(record.id, canonicalHashId);
  assert.equal(record.hostHash, "hash:site-a.com");
  assert.equal(record.hashed, true);
  assert.equal(record.visitCount, 5);
  assert.equal(record.lastVisited, 600);
  assert.deepEqual(writes.stats, { entryDelta: 0, visitDelta: 1 });
});

test("fallback em Map aplica migração de mirrors atomicamente e preserva estado em erro", async () => {
  const sandbox = loadDataSandbox(
    [
      "src/worker/background.database.js",
      "src/worker/background.mirrors.js"
    ],
    { hashValue: async (value) => `hash:${value}` }
  );
  seedMemoryVisits(sandbox, [
    createVisit({
      id: "site-a.com|/p||",
      hostHash: "site-a.com",
      host: "site-a.com",
      visitCount: 2,
      lastVisited: 100
    }),
    createVisit({
      id: "site-b.com|/p||",
      hostHash: "site-b.com",
      host: "site-b.com",
      visitCount: 3,
      lastVisited: 300
    })
  ]);

  await sandbox.setMirrorGroups([["site-a.com", "site-b.com"]]);
  const migrated = readMemoryState(sandbox);

  assert.deepEqual(migrated.mirrorGroups, [{ canonical: "site-a.com", aliases: ["site-b.com"] }]);
  assert.equal(migrated.visits.length, 1);
  assert.equal(migrated.visits[0].id, "site-a.com|/p||");
  assert.equal(migrated.visits[0].visitCount, 5);
  assert.deepEqual(migrated.meta.sort((a, b) => a.key.localeCompare(b.key)), [
    { key: "statsTotalEntries", value: 1 },
    { key: "statsTotalVisits", value: 5 }
  ]);

  assert.throws(
    () => sandbox.applyVisitMirrorStateToMemoryAtomically({
      groups: [{ canonical: "", aliases: [] }],
      deleteIds: ["site-a.com|/p||"],
      upsertRecords: []
    }),
    /mirrorGroupsInvalid/
  );
  assert.deepEqual(readMemoryState(sandbox), migrated);
});
