const apiImport = typeof browser !== "undefined" ? browser : chrome;
const importButtons = document.querySelectorAll("[data-import-addresses]");

let hiddenImportInput = null;


function ensureImportInput() {
  if (hiddenImportInput) return hiddenImportInput;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,text/plain";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const response = await apiImport.runtime.sendMessage({
        type: "IMPORT_ADDRESSES",
        content: text
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : "Falha ao importar");
      }
      alert(`Importação concluída. Registros adicionados: ${response.imported || 0}`);
      if (window.loadHistory) {
        window.loadHistory();
      }
    } catch (error) {
      alert("Erro ao importar endereços: " + (error && error.message ? error.message : error));
    } finally {
      input.value = "";
    }
  });
  hiddenImportInput = input;
  return input;
}

if (importButtons && importButtons.length) {
  importButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = ensureImportInput();
      input.click();
    });
  });
}
