(() => {
  const domains = window.AkiDomains || {};

  function extractDomainInput(value) {
    return domains.extractDomainInput ? domains.extractDomainInput(value) : String(value || "").trim().toLowerCase();
  }

  function normalizeDomainInput(value) {
    return domains.normalizeDomainInput ? domains.normalizeDomainInput(value) : extractDomainInput(value);
  }

  function sanitizeTypedDomainInput(value) {
    return domains.sanitizeTypedDomainInput
      ? domains.sanitizeTypedDomainInput(value)
      : String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9.-]/g, "");
  }

  function splitDomainInput(text) {
    return String(text || "")
      .split(/\s+/)
      .map(normalizeDomainInput)
      .filter(Boolean);
  }

  function splitPastedDomains(text) {
    return String(text || "")
      .split(/\s+/)
      .map(normalizeDomainInput)
      .filter(Boolean);
  }

  function insertTextAtSelection(input, text) {
    const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === "number" ? input.selectionEnd : start;
    input.setRangeText(text, start, end, "end");
    input.value = normalizeDomainInput(input.value);
  }

  function selector(prefix, part) {
    return `.${prefix}-${part}`;
  }

  function resolveEditor(root, prefix) {
    if (!root) {
      return null;
    }
    const editorClass = `${prefix}-tag-editor`;
    if (root.classList && root.classList.contains(editorClass)) {
      return root;
    }
    return root.querySelector(selector(prefix, "tag-editor"));
  }

  function getParts(root, prefix) {
    const editor = resolveEditor(root, prefix);
    if (!editor) {
      return null;
    }
    const tagsEl = editor.querySelector(selector(prefix, "tags"));
    const input = editor.querySelector(selector(prefix, "tag-input"));
    if (!tagsEl || !input) {
      return null;
    }
    return { editor, tagsEl, input };
  }

  function createTagElement(prefix, value, onChange) {
    const notifyChange = typeof onChange === "function" ? onChange : () => {};
    const tag = document.createElement("span");
    tag.className = `${prefix}-tag`;
    tag.dataset.value = value;

    const label = document.createElement("span");
    label.className = `${prefix}-tag-text`;
    label.textContent = value;
    tag.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.className = `${prefix}-tag-remove`;
    removeBtn.type = "button";
    const removeLabel = typeof t === "function" ? t("remove") : "Remove";
    removeBtn.setAttribute("aria-label", removeLabel);
    removeBtn.setAttribute("title", removeLabel);
    removeBtn.addEventListener("click", () => {
      tag.remove();
      notifyChange();
    });
    tag.appendChild(removeBtn);

    return tag;
  }

  function addTag(tagsEl, prefix, value, onChange) {
    const normalized = normalizeDomainInput(value);
    if (!tagsEl || !normalized) {
      return false;
    }

    const duplicate = Array.from(tagsEl.querySelectorAll(selector(prefix, "tag"))).some(
      (tag) => tag.dataset.value === normalized
    );
    if (duplicate) {
      return false;
    }

    tagsEl.appendChild(createTagElement(prefix, normalized, onChange));
    return true;
  }

  function getItems(root, prefix) {
    const editor = resolveEditor(root, prefix);
    if (!editor) {
      return [];
    }
    return Array.from(editor.querySelectorAll(selector(prefix, "tag")))
      .map((tag) => tag.dataset.value)
      .filter(Boolean);
  }

  function commitEditor(root, prefix, onChange) {
    const parts = getParts(root, prefix);
    if (!parts) {
      return false;
    }

    const values = splitDomainInput(parts.input.value);
    if (values.length === 0) {
      parts.input.value = "";
      return false;
    }

    const changed = values.reduce(
      (didChange, value) => addTag(parts.tagsEl, prefix, value, onChange) || didChange,
      false
    );
    parts.input.value = "";
    return changed;
  }

  function setItems(root, prefix, items, onChange) {
    const parts = getParts(root, prefix);
    if (!parts) {
      return;
    }

    while (parts.tagsEl.firstChild) {
      parts.tagsEl.removeChild(parts.tagsEl.firstChild);
    }
    (Array.isArray(items) ? items : []).forEach((item) => addTag(parts.tagsEl, prefix, item, onChange));
  }

  function setupEditor(root, options) {
    const prefix = options && options.prefix;
    const onChange = options && typeof options.onChange === "function" ? options.onChange : () => {};
    const parts = getParts(root, prefix);
    if (!parts) {
      return null;
    }

    setItems(parts.editor, prefix, options.initialItems || [], onChange);

    parts.editor.addEventListener("click", () => {
      parts.input.focus();
    });

    parts.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (commitEditor(parts.editor, prefix, onChange)) {
          onChange();
        }
        return;
      }

      if (event.key === "Backspace" && parts.input.value === "") {
        const lastTag = parts.tagsEl.querySelector(`${selector(prefix, "tag")}:last-child`);
        if (lastTag) {
          lastTag.remove();
          onChange();
        }
      }
    });

    parts.input.addEventListener("beforeinput", (event) => {
      if (event.inputType !== "insertText" || !event.data) {
        return;
      }

      if (!/^[a-z0-9.-]+$/i.test(event.data)) {
        event.preventDefault();
      }
    });

    parts.input.addEventListener("input", () => {
      const sanitized = sanitizeTypedDomainInput(parts.input.value);
      if (parts.input.value !== sanitized) {
        parts.input.value = sanitized;
      }
    });

    parts.input.addEventListener("blur", () => {
      if (commitEditor(parts.editor, prefix, onChange)) {
        onChange();
      }
    });

    parts.input.addEventListener("paste", (event) => {
      const pasted = event.clipboardData ? event.clipboardData.getData("text") : "";
      const domains = splitPastedDomains(pasted);
      if (domains.length === 0) {
        event.preventDefault();
        return;
      }

      if (domains.length === 1) {
        event.preventDefault();
        insertTextAtSelection(parts.input, domains[0]);
        return;
      }

      event.preventDefault();
      const committedCurrentInput = commitEditor(parts.editor, prefix, onChange);
      const addedPastedDomains = domains.reduce(
        (didChange, domain) => addTag(parts.tagsEl, prefix, domain, onChange) || didChange,
        false
      );
      parts.input.value = "";
      if (committedCurrentInput || addedPastedDomains) {
        onChange();
      }
    });

    return {
      addItem: (value) => addTag(parts.tagsEl, prefix, value, onChange),
      commit: () => commitEditor(parts.editor, prefix, onChange),
      getItems: () => getItems(parts.editor, prefix),
      setItems: (items) => setItems(parts.editor, prefix, items, onChange)
    };
  }

  window.AkiDomainTags = {
    commitEditor,
    extractDomainInput,
    getItems,
    normalizeDomainInput,
    setItems,
    setupEditor
  };
})();
