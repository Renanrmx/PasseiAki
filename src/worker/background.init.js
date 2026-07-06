(function initBackground() {
  const run = () => {
    if (typeof bootstrapActiveTab === "function") {
      bootstrapActiveTab();
    }
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
  } else {
    setTimeout(run, 0);
  }
})();
