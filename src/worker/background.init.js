(function initBackground() {
  const run = async () => {
    try {
      if (typeof ensureWwwNormalizationMigration === "function") {
        await ensureWwwNormalizationMigration();
      }
      if (typeof bootstrapActiveTab === "function") {
        await bootstrapActiveTab();
      }
    } catch (error) {
      // ignore startup migration/bootstrap errors; handlers will retry when needed
    }
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
  } else {
    setTimeout(run, 0);
  }
})();
