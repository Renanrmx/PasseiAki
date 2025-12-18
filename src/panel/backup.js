const apiExport = typeof browser !== "undefined" ? browser : chrome;

const createBackupBtn = document.getElementById("create-bkp-btn");
const restoreBackupBtn = document.getElementById("restore-bkp-btn");
const restoreBackupFile = document.getElementById("restore-bkp-file");
const encryptionToggle = document.getElementById("encryption-toggle");
const encryptionStatus = document.getElementById("encryption-status");
const passwordTitle = document.getElementById("password-title");
const passwordDesc = document.getElementById("password-desc");
const passwordInput = document.getElementById("password-input");
const passwordError = document.getElementById("password-error");
const passwordCancel = document.getElementById("password-cancel");
const passwordConfirm = document.getElementById("password-confirm");
const passwordConfirmInput = document.getElementById("password-confirm-input");
const overlay = document.getElementById("password-overlay");
const passwordForm = document.getElementById("password-form");

let passwordResolve = null;
let passwordReject = null;


function showPasswordDialog({ title, description, requireConfirm = true }) {
  return new Promise((resolve, reject) => {
    passwordResolve = resolve;
    passwordReject = reject;
    passwordTitle.textContent = title || "Senha";
    passwordDesc.textContent = description || "";
    passwordError.textContent = "";
    passwordInput.value = "";
    passwordConfirmInput.value = "";
    if (requireConfirm) {
      passwordConfirmInput.style.display = "block";
    } else {
      passwordConfirmInput.style.display = "none";
    }
    overlay.classList.add("active");
    passwordInput.focus();
    setTimeout(() => {
      passwordInput.focus();
    }, 20);
  });
}

function closePasswordDialog() {
  overlay.classList.remove("active");
  passwordResolve = null;
  passwordReject = null;
}

passwordCancel.addEventListener("click", () => {
  if (passwordResolve) passwordResolve(null);
  closePasswordDialog();
});

passwordConfirm.addEventListener("click", () => {
  if (!passwordResolve) return;
  if (!passwordInput.value) {
    passwordError.textContent = "Defina uma senha";
    return;
  }
  if (passwordConfirmInput.style.display !== "none") {
    const confirmVal = passwordConfirmInput.value || passwordInput.value;
    if (passwordInput.value !== confirmVal) {
      passwordError.textContent = "As senhas não coincidem";
      return;
    }
  }
  passwordResolve(passwordInput.value);
  closePasswordDialog();
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    passwordConfirm.click();
  } else if (e.key === "Escape") {
    passwordCancel.click();
  }
});

if (passwordForm) {
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (passwordConfirm) {
      passwordConfirm.click();
    }
  });
}

async function doExport() {
    const password = await showPasswordDialog({
      title: "Criar backup",
      description: "Defina uma senha para proteger o backup",
      requireConfirm: true
    });
  if (!password) return;
  try {
    await apiExport.runtime.sendMessage({
      type: "CREATE_BACKUP_DOWNLOAD",
      password
    });
  } catch (error) {
    alert("Erro ao exportar: " + error.message);
  }
}

async function doImport(file) {
  try {
    if (!file) {
      return;
    }
    const password = await showPasswordDialog({
      title: "Restaurar backup",
      description: "Ao continuar os dados de acesso atuais serão perdidos. Informe a senha usada no backup.",
      requireConfirm: false
    });
    if (!password) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const envelope = JSON.parse(reader.result);
        const response = await apiExport.runtime.sendMessage({
          type: "RESTORE_BACKUP",
          password,
          envelope
        });
        if (!response || response.ok === false) {
          throw new Error(response && response.error ? response.error : "Restauração do backup falhou");
        }
        alert("Restauração do backup concluída");        
        setTimeout(() => window.location.reload(), 200);
      } catch (error) {
        alert("Erro ao restaurar: " + (error && error.message ? error.message : error));
      }
    };
    reader.onerror = (e) => {
      alert("Erro ao ler arquivo de backup");
    };
    reader.readAsText(file);
  } catch (error) {
    alert("Erro ao restaurar: " + (error && error.message ? error.message : error));
  }
}

window.addEventListener("unhandledrejection", (event) => {
  alert("Erro inesperado: " + (event.reason && event.reason.message ? event.reason.message : event.reason));
});

window.addEventListener("error", (event) => {
  if (event && (event.error || event.message)) {
    alert("Erro: " + (event.error?.message || event.message));
  }
});

if (createBackupBtn) {
  createBackupBtn.addEventListener("click", () => {
    doExport();
  });
}

if (restoreBackupBtn) {
  restoreBackupBtn.addEventListener("click", (event) => {
    if (restoreBackupFile) {
      restoreBackupFile.value = "";
      restoreBackupFile.click();
    }
  });
}

if (restoreBackupFile) {
  const onFileSelected = (e) => {
    if (!e.target.files || !e.target.files.length) {
      return;
    }
    const file = e.target.files && e.target.files[0];
    doImport(file);
    restoreBackupFile.value = "";
  };
  restoreBackupFile.addEventListener("change", onFileSelected);
  restoreBackupFile.addEventListener("input", onFileSelected);
}

async function syncEncryptionUI() {
  if (!encryptionToggle || !encryptionStatus) return;
  try {
    const result = await apiExport.runtime.sendMessage({ type: "GET_ENCRYPTION_ENABLED" });
    const enabled = Boolean(result && result.encryptionEnabled);
    encryptionToggle.checked = enabled;
    updateEncryptionStatus(enabled);
  } catch (error) {
    encryptionToggle.checked = true;
    updateEncryptionStatus(true);
  }
}

function updateEncryptionStatus(enabled) {
  if (!encryptionStatus) return;
  if (enabled) {
    encryptionStatus.textContent =
      "Links criptografados e mantidos localmente";
    encryptionStatus.classList.remove("bad");
  } else {
    encryptionStatus.textContent = "Links não criptografados";
    encryptionStatus.classList.add("bad");
  }
}

if (encryptionToggle) {
  encryptionToggle.addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    updateEncryptionStatus(enabled);
    try {
      await apiExport.runtime.sendMessage({
        type: "SET_ENCRYPTION_ENABLED",
        enabled
      });
    } catch (error) {
      // ignore
    }
  });
  
  syncEncryptionUI();
}
