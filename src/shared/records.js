(function registerRecordHelpers(root) {
  function buildAddressFromRecord(item) {
    const host = item.host || "";
    const path = item.path || "";
    const query = item.query ? `?${item.query}` : "";
    const fragment = item.fragment ? `#${item.fragment}` : "";
    return `${host}${path}${query}${fragment}`;
  }

  root.buildAddressFromRecord = buildAddressFromRecord;
})(globalThis);
