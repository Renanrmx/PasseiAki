const exportAddressesBtn = document.getElementById("export-addresses-btn");


async function exportAddresses() {
  try {
    const response = await apiExport.runtime.sendMessage({ type: "EXPORT_VISITS_CSV" });
    if (!response || response.ok === false) {
      throw new Error(response && response.error ? response.error : "Falha ao exportar");
    }
    if (response.exported === 0) {
      alert("Nenhum endereço não anônimo para exportar.");
    }
  } catch (error) {
    alert("Erro ao exportar endereços: " + (error && error.message ? error.message : error));
  }
}

if (exportAddressesBtn) {
  exportAddressesBtn.addEventListener("click", () => {
    exportAddresses();
  });
}
