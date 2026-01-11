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
const restoreOptions = document.getElementById("restore-options");
const restoreMerge = document.getElementById("restore-merge");
const restoreOnly = document.getElementById("restore-only");
const restoreMergeWarning = document.getElementById("restore-merge-warning");
const restoreOnlyWarning = document.getElementById("restore-only-warning");

let passwordResolve = null;
let passwordReject = null;
let passwordRequireConfirm = true;
let restoreOptionsVisible = false;
let encryptionEnabledState = null;

const MIN_PASSWORD_LENGTH = 3;

// Ensure translation in case applyI18n was not executed by another script
if (typeof applyI18n === "function") {
  applyI18n();
}


function setPasswordDescription(description) {
  if (!passwordDesc) return;
  passwordDesc.textContent = "";
  if (typeof description === "string") {
    passwordDesc.textContent = description;
    return;
  }
  if (!description || typeof description !== "object") {
    return;
  }
  const hasMainText = Boolean(description.text);
  if (description.text) {
    passwordDesc.appendChild(document.createTextNode(description.text));
  }
  if (description.extra) {
    if (hasMainText) {
      passwordDesc.appendChild(document.createElement("br"));
    }
    passwordDesc.appendChild(document.createTextNode(description.extra));
    if (description.icon) {
      passwordDesc.appendChild(document.createTextNode(" "));
      const icon = document.createElement("span");
      icon.className = "warning-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "!";
      passwordDesc.appendChild(icon);
    }
    return;
  }
  if (description.icon) {
    const icon = document.createElement("span");
    icon.className = "warning-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";
    passwordDesc.appendChild(icon);
  }
}

function updateRestoreWarnings() {
  if (restoreMergeWarning && restoreMerge) {
    restoreMergeWarning.style.display = restoreMerge.checked ? "inline" : "none";
  }
  if (restoreOnlyWarning && restoreOnly) {
    restoreOnlyWarning.style.display = restoreOnly.checked ? "inline" : "none";
  }
}

function showPasswordDialog({ title, description, requireConfirm = true, showRestoreOptions = false }) {
  return new Promise((resolve, reject) => {
    passwordRequireConfirm = Boolean(requireConfirm);
    passwordResolve = resolve;
    passwordReject = reject;
    passwordTitle.textContent = title || t("passwordLabel");
    setPasswordDescription(description || "");
    passwordError.textContent = "";
    passwordInput.value = "";
    passwordConfirmInput.value = "";
    if (requireConfirm) {
      passwordConfirmInput.style.display = "block";
    } else {
      passwordConfirmInput.style.display = "none";
    }
    restoreOptionsVisible = Boolean(showRestoreOptions && restoreOptions);
    if (restoreOptions) {
      restoreOptions.style.display = restoreOptionsVisible ? "flex" : "none";
    }
    if (restoreMerge) {
      restoreMerge.checked = true;
    }
    if (restoreOnly && !restoreOptionsVisible) {
      restoreOnly.checked = false;
    }
    updateRestoreWarnings();
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
  restoreOptionsVisible = false;
}

passwordCancel.addEventListener("click", () => {
  if (passwordResolve) passwordResolve(null);
  closePasswordDialog();
});

passwordConfirm.addEventListener("click", () => {
  if (!passwordResolve) return;
  if (!passwordInput.value) {
    passwordError.textContent = t("setPassword");
    return;
  }
  if (passwordInput.value.length < MIN_PASSWORD_LENGTH) {
    passwordError.textContent = t("passwordMinimumLength", [MIN_PASSWORD_LENGTH]);
    return;
  }
  if (passwordRequireConfirm) {
    if (!passwordConfirmInput.value) {
      passwordError.textContent = t("passwordConfirmation");
      return;
    }
    if (passwordInput.value !== passwordConfirmInput.value) {
      passwordError.textContent = t("passwordMismatch");
      return;
    }
  }
  const result = { password: passwordInput.value };
  if (restoreOptionsVisible) {
    result.mergeVisits = restoreMerge ? restoreMerge.checked : true;
  }
  passwordResolve(result);
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
  const result = await showPasswordDialog({
    title: t("createBackup"),
    description: t("createBackupDesc"),
    requireConfirm: true
  });
  if (!result || !result.password) return;
  try {
    await apiExport.runtime.sendMessage({
      type: "CREATE_BACKUP_DOWNLOAD",
      password: result.password
    });
  } catch (error) {
    alert(t("backupExportError", error.message));
  }
}

async function doImport(file) {
  try {
    if (!file) {
      return;
    }
    const encryptionEnabled = await getEncryptionEnabledState();
    const description = encryptionEnabled === false
      ? { text: t("restoreBackupInst") }
      : { text: t("restoreBackupDesc"), icon: true, extra: t("restoreBackupInst") };
    const result = await showPasswordDialog({
      title: t("restoreBackup"),
      description,
      requireConfirm: false,
      showRestoreOptions: encryptionEnabled === false
    });
    if (!result || !result.password) return;
    const mergeVisits = result.mergeVisits === true;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const envelope = JSON.parse(reader.result);
        const response = await apiExport.runtime.sendMessage({
          type: "RESTORE_BACKUP",
          password: result.password,
          envelope,
          mergeVisits
        });
        if (!response || response.ok === false) {
          throw new Error(response && response.error ? response.error : "Backup restore failed");
        }
        alert(t("restoreComplete"));
        setTimeout(() => window.location.reload(), 200);
      } catch (error) {
        alert(t("restoreError", error && error.message ? error.message : error));
      }
    };
    reader.onerror = () => {
      alert(t("backupReadError"));
    };
    reader.readAsText(file);
  } catch (error) {
    alert(t("restoreError", error && error.message ? error.message : error));
  }
}

window.addEventListener("unhandledrejection", (event) => {
  alert(t("unexpectedError", event.reason && event.reason.message ? event.reason.message : event.reason));
});

window.addEventListener("error", (event) => {
  if (event && (event.error || event.message)) {
    alert(t("genericError", event.error?.message || event.message));
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

if (restoreMerge) {
  restoreMerge.addEventListener("change", updateRestoreWarnings);
}

if (restoreOnly) {
  restoreOnly.addEventListener("change", updateRestoreWarnings);
}

async function syncEncryptionUI() {
  if (!encryptionToggle || !encryptionStatus) return;
  try {
    const result = await apiExport.runtime.sendMessage({ type: "GET_ENCRYPTION_ENABLED" });
    const enabled = Boolean(result && result.encryptionEnabled);
    encryptionEnabledState = enabled;
    encryptionToggle.checked = enabled;
    updateEncryptionStatus(enabled);
  } catch (error) {
    encryptionEnabledState = true;
    encryptionToggle.checked = true;
    updateEncryptionStatus(true);
  }
}

function updateEncryptionStatus(enabled) {
  if (!encryptionStatus) return;
  encryptionEnabledState = enabled;
  if (enabled) {
    encryptionStatus.textContent =
      t("encryptedStatus");
    encryptionStatus.classList.remove("bad");
  } else {
    encryptionStatus.textContent = t("unencryptedStatus");
    encryptionStatus.classList.add("bad");
  }
}

async function getEncryptionEnabledState() {
  if (typeof encryptionEnabledState === "boolean") {
    return encryptionEnabledState;
  }
  try {
    const result = await apiExport.runtime.sendMessage({ type: "GET_ENCRYPTION_ENABLED" });
    encryptionEnabledState = Boolean(result && result.encryptionEnabled);
    return encryptionEnabledState;
  } catch (error) {
    encryptionEnabledState = true;
    return encryptionEnabledState;
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
