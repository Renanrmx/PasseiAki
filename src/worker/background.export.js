function formatDateTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function shouldExportPlainVisit(visit, includePages, includeDownloads) {
  if (!visit || visit.hashed !== false) return false;
  if (visit.download === true) return includeDownloads;
  return includePages;
}

async function exportPlainVisitsCsv(filename, options = {}) {
  const includePages = options.includePages !== false;
  const includeDownloads = options.includeDownloads === true;
  const lines = [i18n("csvHeader")];
  let exported = 0;

  await forEachVisitByLastVisited((visit) => {
    if (!shouldExportPlainVisit(visit, includePages, includeDownloads)) {
      return true;
    }
    const address = buildAddressFromRecord(visit);
    const date = formatDateTime(visit.lastVisited);
    const count = typeof visit.visitCount === "number" ? visit.visitCount : 0;
    const type = visit.download === true ? i18n("exportTypeDownload") : i18n("exportTypePage");
    lines.push([csvEscape(address), csvEscape(date), count, csvEscape(type)].join(";"));
    exported += 1;
    return true;
  });

  const csvContent = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const { url: objectUrl, revoke } = await buildDownloadUrl(blob, "text/csv;charset=utf-8");

  try {
    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: objectUrl,
        filename: filename || `passei-aki_acessos-${Date.now()}.csv`,
        saveAs: true
      });
    } else {
      throw new Error("Download API unavailable");
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }

  return { exported };
}

async function exportPlainVisitsTxt(filename, options = {}) {
  const includePages = options.includePages !== false;
  const includeDownloads = options.includeDownloads === true;
  const lines = [];
  let exported = 0;

  await forEachVisitByLastVisited((visit) => {
    if (!shouldExportPlainVisit(visit, includePages, includeDownloads)) {
      return true;
    }
    lines.push(buildAddressFromRecord(visit));
    exported += 1;
    return true;
  });

  const txtContent = lines.join("\n");
  const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
  const { url: objectUrl, revoke } = await buildDownloadUrl(blob, "text/plain;charset=utf-8");

  try {
    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: objectUrl,
        filename: filename || `passei-aki_acessos-${Date.now()}.txt`,
        saveAs: true
      });
    } else {
      throw new Error("Download API unavailable");
    }
  } finally {
    if (revoke) {
      setTimeout(() => revoke(), 5000);
    }
  }

  return { exported };
}
