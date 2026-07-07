(() => {
  const apiMirrors =
    window.apiExport || (window.apiExport = typeof browser !== "undefined" ? browser : chrome);
  const MSG = globalThis.AKI_MESSAGE_TYPES;

  const listEl = document.getElementById("mirror-groups-list");
  const emptyEl = document.getElementById("mirror-empty");
  const statusEl = document.getElementById("mirror-status");
  const addBtn = document.getElementById("add-mirror-group");
  const template = document.getElementById("mirror-group-template");
  const AUTO_SAVE_DELAY_MS = 1200;
  let autoSaveTimer = 0;
  let autoSaveInFlight = false;
  let pendingAutoSave = false;
  let lastSavedSignature = "[]";

  function setStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "success");
    if (type) {
      statusEl.classList.add(type);
    }
  }

  function getGroupHosts(group) {
    if (!group || typeof group.canonical !== "string") {
      return [];
    }
    return [group.canonical].concat(Array.isArray(group.aliases) ? group.aliases : []);
  }

  function getEditorHosts(editor) {
    return window.AkiDomainTags.getItems(editor, "mirror");
  }

  function setupTagEditor(node, group) {
    window.AkiDomainTags.setupEditor(node, {
      prefix: "mirror",
      initialItems: getGroupHosts(group),
      onChange: scheduleAutoSave
    });
  }

  function updateEmptyState() {
    if (!emptyEl || !listEl) return;
    emptyEl.classList.toggle("active", listEl.children.length === 0);
  }

  function refreshGroupTitles() {
    if (!listEl) return;
    Array.from(listEl.children).forEach((item, index) => {
      const title = item.querySelector("h2");
      if (title) {
        title.textContent = t("mirrorGroupTitle", [item.dataset.savedCanonical || String(index + 1)]);
      }
    });
  }

  function createGroupElement(group) {
    const node = template.content.firstElementChild.cloneNode(true);
    const removeBtn = node.querySelector(".remove-group");
    setupTagEditor(node, group);
    if (group && typeof group.canonical === "string" && group.canonical) {
      node.dataset.savedCanonical = group.canonical;
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        node.remove();
        refreshGroupTitles();
        updateEmptyState();
        scheduleAutoSave();
      });
    }
    applyI18n(node);
    return node;
  }

  function renderGroups(groups) {
    if (!listEl) return;
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      listEl.appendChild(createGroupElement(group));
    });
    refreshGroupTitles();
    updateEmptyState();
  }

  function applySavedGroupsToCurrentItems(groups) {
    if (!listEl) return;
    const savedGroups = Array.isArray(groups) ? groups : [];
    let savedIndex = 0;
    Array.from(listEl.children).forEach((item) => {
      const editor = item.querySelector(".mirror-tag-editor");
      const hosts = editor ? getEditorHosts(editor) : [];
      if (hosts.length < 2) {
        delete item.dataset.savedCanonical;
        return;
      }

      const savedGroup = savedGroups[savedIndex];
      if (savedGroup && typeof savedGroup.canonical === "string" && savedGroup.canonical) {
        item.dataset.savedCanonical = savedGroup.canonical;
        savedIndex += 1;
      } else {
        delete item.dataset.savedCanonical;
      }
    });
    refreshGroupTitles();
  }

  function collectGroupDrafts(commitPendingInput) {
    if (!listEl) return [];
    return Array.from(listEl.querySelectorAll(".mirror-tag-editor"))
      .map((editor, index) => {
        if (commitPendingInput) {
          window.AkiDomainTags.commitEditor(editor, "mirror");
        }
        return {
          index: index + 1,
          hosts: getEditorHosts(editor)
        };
      });
  }

  function collectGroups(commitPendingInput) {
    return collectGroupDrafts(commitPendingInput)
      .map((draft) => draft.hosts)
      .filter((hosts) => hosts.length > 0);
  }

  function getIncompleteGroup(drafts) {
    return drafts.find((draft) => draft.hosts.length === 1);
  }

  function groupsSignature(groups) {
    return JSON.stringify(groups);
  }

  async function loadGroups() {
    const closeLoading =
      typeof showPanelLoading === "function"
        ? showPanelLoading(window.getPanelLoadingMessage("loadingMirrorGroups", "Loading mirrors..."))
        : null;
    try {
      const response = await apiMirrors.runtime.sendMessage({ type: MSG.GET_MIRROR_GROUPS });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : t("mirrorGroupsLoadFailed"));
      }
      const groups = response.groups || [];
      renderGroups(groups);
      lastSavedSignature = groupsSignature(groups.map(getGroupHosts));
      setStatus("");
    } catch (error) {
      renderGroups([]);
      setStatus(error && error.message ? error.message : t("mirrorGroupsLoadFailed"), "error");
    } finally {
      if (closeLoading) closeLoading();
    }
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = 0;
      saveGroupsAutomatically();
    }, AUTO_SAVE_DELAY_MS);
  }

  async function saveGroupsAutomatically() {
    const drafts = collectGroupDrafts(false);
    const incompleteGroup = getIncompleteGroup(drafts);
    if (incompleteGroup) {
      setStatus(t("mirrorGroupNeedsTwoDomains", [String(incompleteGroup.index)]), "error");
      return;
    }

    const groups = collectGroups(false);
    const signature = groupsSignature(groups);
    if (signature === lastSavedSignature) {
      setStatus("");
      return;
    }

    if (autoSaveInFlight) {
      pendingAutoSave = true;
      return;
    }

    autoSaveInFlight = true;
    setStatus(t("loadingSaveMirrorGroups"));
    try {
      const response = await apiMirrors.runtime.sendMessage({
        type: MSG.SET_MIRROR_GROUPS,
        groups
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : t("mirrorGroupsSaveFailed"));
      }
      const savedGroups = response.groups || [];
      lastSavedSignature = groupsSignature(savedGroups.map(getGroupHosts));
      applySavedGroupsToCurrentItems(savedGroups);
      setStatus(t("mirrorGroupsSaved"), "success");
    } catch (error) {
      setStatus(error && error.message ? error.message : t("mirrorGroupsSaveFailed"), "error");
    } finally {
      autoSaveInFlight = false;
      if (pendingAutoSave) {
        pendingAutoSave = false;
        scheduleAutoSave();
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyI18n();
    document.title = t("mirrorGroupsPageTitle");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (!listEl) return;
        listEl.appendChild(createGroupElement(null));
        refreshGroupTitles();
        updateEmptyState();
        const input = listEl.lastElementChild?.querySelector(".mirror-tag-input");
        if (input) {
          input.focus();
        }
      });
    }
    loadGroups();
  });
})();
