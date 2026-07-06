const apiExport = typeof browser !== "undefined" ? browser : chrome;
const backupMessages = globalThis.AKI_MESSAGE_TYPES;

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
const backupPasswordOptions = document.getElementById("backup-password-options");
const backupWithPassword = document.getElementById("backup-with-password");
const backupWithoutPassword = document.getElementById("backup-without-password");
const passwordFields = document.getElementById("password-fields");
const restoreOptions = document.getElementById("restore-options");
const restoreMerge = document.getElementById("restore-merge");
const restoreOnly = document.getElementById("restore-only");
const restoreMergeWarning = document.getElementById("restore-merge-warning");
const restoreOnlyWarning = document.getElementById("restore-only-warning");

let passwordResolve = null;
let passwordReject = null;
let passwordRequireConfirm = true;
let passwordRequired = true;
let backupPasswordOptionsVisible = false;
let backupProtectWithPassword = true;
let restoreOptionsVisible = false;
let encryptionEnabledState = null;

const MIN_PASSWORD_LENGTH = 3;
const PLAIN_BACKUP_TYPE = "passei-aki-backup";
const PLAIN_BACKUP_VERSION = 1;

function showBackupLoading(message) {
  if (typeof window.showPanelLoading === "function") {
    return window.showPanelLoading(message);
  }
  return () => {};
}

function getBackupLoadingMessage(key, fallback) {
  if (typeof window.getPanelLoadingMessage === "function") {
    return window.getPanelLoadingMessage(key, fallback);
  }
  return fallback;
}

function isPlainBackupEnvelope(envelope) {
  return Boolean(
    envelope &&
      typeof envelope === "object" &&
      !Array.isArray(envelope) &&
      envelope.v === PLAIN_BACKUP_VERSION &&
      envelope.type === PLAIN_BACKUP_TYPE &&
      envelope.encrypted === false
  );
}

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

function setPasswordFieldsVisible(visible) {
  if (passwordFields) {
    passwordFields.style.display = visible ? "block" : "none";
  }
}

function setBackupPasswordMode(withPassword, options = {}) {
  backupProtectWithPassword = withPassword !== false;
  if (backupWithPassword) {
    backupWithPassword.checked = backupProtectWithPassword;
  }
  if (backupWithoutPassword) {
    backupWithoutPassword.checked = !backupProtectWithPassword;
  }
  passwordRequired = backupProtectWithPassword;
  setPasswordFieldsVisible(passwordRequired);
  if (passwordError) {
    passwordError.textContent = "";
  }
  if (passwordRequired && options.focus === true && passwordInput) {
    passwordInput.focus();
  }
}

function showPasswordDialog({
  title,
  description,
  requireConfirm = true,
  showRestoreOptions = false,
  showBackupPasswordOptions = false,
  requirePassword = true
}) {
  return new Promise((resolve, reject) => {
    passwordRequireConfirm = Boolean(requireConfirm);
    passwordRequired = requirePassword !== false;
    backupPasswordOptionsVisible = Boolean(showBackupPasswordOptions && backupPasswordOptions);
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
    if (backupPasswordOptions) {
      backupPasswordOptions.style.display = backupPasswordOptionsVisible ? "flex" : "none";
    }
    if (backupPasswordOptionsVisible) {
      setBackupPasswordMode(true);
    } else {
      backupProtectWithPassword = true;
      setPasswordFieldsVisible(passwordRequired);
    }
    restoreOptionsVisible = Boolean(showRestoreOptions && restoreOptions);
    if (restoreOptions) {
      restoreOptions.style.display = restoreOptionsVisible ? "flex" : "none";
    }
    if (restoreMerge) {
      restoreMerge.checked = true;
    }
    if (restoreOnly) {
      restoreOnly.checked = false;
    }
    updateRestoreWarnings();
    overlay.classList.add("active");
    const focusTarget = passwordRequired ? passwordInput : passwordConfirm;
    if (focusTarget) {
      focusTarget.focus();
    }
    setTimeout(() => {
      if (focusTarget) {
        focusTarget.focus();
      }
    }, 20);
  });
}

function closePasswordDialog() {
  overlay.classList.remove("active");
  passwordResolve = null;
  passwordReject = null;
  restoreOptionsVisible = false;
  backupPasswordOptionsVisible = false;
}

passwordCancel.addEventListener("click", () => {
  if (passwordResolve) passwordResolve(null);
  closePasswordDialog();
});

passwordConfirm.addEventListener("click", () => {
  if (!passwordResolve) return;
  if (passwordRequired) {
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
  }
  const result = {};
  if (passwordRequired) {
    result.password = passwordInput.value;
  }
  if (backupPasswordOptionsVisible) {
    result.protectWithPassword = backupProtectWithPassword;
  }
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

if (backupWithPassword) {
  backupWithPassword.addEventListener("change", () => {
    setBackupPasswordMode(backupWithPassword.checked, { focus: backupWithPassword.checked });
  });
}

if (backupWithoutPassword) {
  backupWithoutPassword.addEventListener("change", () => {
    setBackupPasswordMode(!backupWithoutPassword.checked);
  });
}

async function doExport() {
  const result = await showPasswordDialog({
    title: t("createBackup"),
    description: t("createBackupDesc"),
    requireConfirm: true,
    showBackupPasswordOptions: true,
    requirePassword: true
  });
  if (!result) return;
  const protectWithPassword = result.protectWithPassword !== false;
  if (protectWithPassword && !result.password) return;
  const hideLoading = showBackupLoading(getBackupLoadingMessage("loadingCreateBackup", "Creating backup..."));
  try {
    const message = {
      type: backupMessages.CREATE_BACKUP_DOWNLOAD,
      protectWithPassword
    };
    if (protectWithPassword) {
      message.password = result.password;
    }
    await apiExport.runtime.sendMessage(message);
  } catch (error) {
    hideLoading();
    alert(t("backupExportError", error.message));
    return;
  } finally {
    hideLoading();
  }
}

async function doImport(file) {
  try {
    if (!file) {
      return;
    }
    const envelope = JSON.parse(await file.text());
    const isPlainBackup = isPlainBackupEnvelope(envelope);
    if (isPlainBackup) {
      const result = await showPasswordDialog({
        title: t("restoreBackup"),
        description: "",
        requireConfirm: false,
        requirePassword: false,
        showRestoreOptions: true
      });
      if (!result) return;
      const mergeVisits = result.mergeVisits === true;
      const hideLoading = showBackupLoading(getBackupLoadingMessage("loadingRestoreBackup", "Restoring backup..."));
      try {
        const response = await apiExport.runtime.sendMessage({
          type: backupMessages.RESTORE_BACKUP,
          envelope,
          mergeVisits
        });
        if (!response || response.ok === false) {
          throw new Error(response && response.error ? response.error : t("backupRestoreFailed"));
        }
        hideLoading();
        alert(t("restoreComplete"));
        setTimeout(() => window.location.reload(), 200);
      } catch (error) {
        hideLoading();
        alert(t("restoreError", error && error.message ? error.message : error));
      } finally {
        hideLoading();
      }
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
    const hideLoading = showBackupLoading(getBackupLoadingMessage("loadingRestoreBackup", "Restoring backup..."));

    try {
      const response = await apiExport.runtime.sendMessage({
        type: backupMessages.RESTORE_BACKUP,
        password: result.password,
        envelope,
        mergeVisits
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : t("backupRestoreFailed"));
      }
      hideLoading();
      alert(t("restoreComplete"));
      setTimeout(() => window.location.reload(), 200);
    } catch (error) {
      hideLoading();
      alert(t("restoreError", error && error.message ? error.message : error));
    } finally {
      hideLoading();
    }
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
    const result = await apiExport.runtime.sendMessage({ type: backupMessages.GET_ENCRYPTION_ENABLED });
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
    const result = await apiExport.runtime.sendMessage({ type: backupMessages.GET_ENCRYPTION_ENABLED });
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
        type: backupMessages.SET_ENCRYPTION_ENABLED,
        enabled
      });
    } catch (error) {
      // ignore
    }
  });
  
  syncEncryptionUI();
}
