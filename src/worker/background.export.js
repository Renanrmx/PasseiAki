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

async function exportPlainVisitsCsv(filename) {
  const visits = await dumpAllVisits();
  const plainVisits = visits
    .filter((visit) => visit && visit.hashed === false)
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  const lines = [i18n("csvHeader")];

  for (const visit of plainVisits) {
    const address = buildAddressFromRecord(visit);
    const date = formatDateTime(visit.lastVisited);
    const count = typeof visit.visitCount === "number" ? visit.visitCount : 0;
    lines.push([csvEscape(address), csvEscape(date), count].join(";"));
  }

  const csvContent = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

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
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }

  return { exported: plainVisits.length };
}

async function exportPlainVisitsTxt(filename) {
  const visits = await dumpAllVisits();
  const plainVisits = visits
    .filter((visit) => visit && visit.hashed === false)
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));

  const lines = [];
  for (const visit of plainVisits) {
    lines.push(buildAddressFromRecord(visit));
  }

  const txtContent = lines.join("\n");
  const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

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
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }

  return { exported: plainVisits.length };
}
