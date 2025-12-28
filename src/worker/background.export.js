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

async function exportPlainVisitsCsv(filename, options = {}) {
  const visits = await dumpAllVisits();
  const includePages = options.includePages !== false;
  const includeDownloads = options.includeDownloads === true;
  const plainVisits = visits
    .filter((visit) => {
      if (!visit || visit.hashed !== false) return false;
      if (visit.download === true) return includeDownloads;
      return includePages;
    })
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  const lines = [i18n("csvHeader")];

  for (const visit of plainVisits) {
    const address = buildAddressFromRecord(visit);
    const date = formatDateTime(visit.lastVisited);
    const count = typeof visit.visitCount === "number" ? visit.visitCount : 0;
    const type = visit.download === true ? i18n("exportTypeDownload") : i18n("exportTypePage");
    lines.push([csvEscape(address), csvEscape(date), count, csvEscape(type)].join(";"));
  }

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

  return { exported: plainVisits.length };
}

async function exportPlainVisitsTxt(filename, options = {}) {
  const visits = await dumpAllVisits();
  const includePages = options.includePages !== false;
  const includeDownloads = options.includeDownloads === true;
  const plainVisits = visits
    .filter((visit) => {
      if (!visit || visit.hashed !== false) return false;
      if (visit.download === true) return includeDownloads;
      return includePages;
    })
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));

  const lines = [];
  for (const visit of plainVisits) {
    lines.push(buildAddressFromRecord(visit));
  }

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

  return { exported: plainVisits.length };
}
