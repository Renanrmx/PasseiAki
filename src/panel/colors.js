(() => {
  const apiColors = window.apiExport || (window.apiExport = typeof browser !== "undefined" ? browser : chrome);
  const visitedToggle = document.getElementById("visited-color-toggle");
  const partialToggle = document.getElementById("partial-color-toggle");
  const visitedPickerInput = document.getElementById("visited-color-picker");
  const partialPickerInput = document.getElementById("partial-color-picker");
  const visitedSwatch = visitedPickerInput ? visitedPickerInput.parentElement : null;
  const partialSwatch = partialPickerInput ? partialPickerInput.parentElement : null;
  const visitedTextLabel = document.getElementById("visited-text-label");
  const partialTextLabel = document.getElementById("partial-text-label");
  const visitedBorderLabel = document.getElementById("visited-border-label");
  const partialBorderLabel = document.getElementById("partial-border-label");

  let picker = null;
  let pickerPopover = null;
  let activeTarget = null;
  let colorsState = {
    matchHexColor: null,
    partialHexColor: null,
    matchTextEnabled: true,
    partialTextEnabled: true,
    matchBorderEnabled: false,
    partialBorderEnabled: false
  };

  function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const cleaned = value.trim().toLowerCase();
    const match = cleaned.match(/^#?[0-9a-f]{6}$/);
    if (!match) return fallback;
    return cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
  }

  function setSwatchColor(el, color) {
    if (!el) return;
    const inner = el.querySelector("div");
    if (inner) {
      inner.style.background = color;
    }
    const input = el.querySelector("input[type=\"color\"]");
    if (input) {
      input.value = color;
    }
  }

  function setLabelColor(labelEl, color) {
    if (!labelEl) return;
    labelEl.style.color = color;
  }

  function setBorderLabel(labelEl, color) {
    if (!labelEl) return;
    labelEl.style.borderColor = color;
  }

  async function loadColors() {
    try {
      const res = await apiColors.runtime.sendMessage({ type: "GET_LINK_COLORS" });
      if (res && res.colors) {
        colorsState = {
          matchHexColor: normalizeHexColor(res.colors.matchHexColor, null),
          partialHexColor: normalizeHexColor(res.colors.partialHexColor, null),
          matchTextEnabled:
            typeof res.colors.matchTextEnabled === "boolean" ? res.colors.matchTextEnabled : true,
          partialTextEnabled:
            typeof res.colors.partialTextEnabled === "boolean" ? res.colors.partialTextEnabled : true,
          matchBorderEnabled:
            typeof res.colors.matchBorderEnabled === "boolean" ? res.colors.matchBorderEnabled : false,
          partialBorderEnabled:
            typeof res.colors.partialBorderEnabled === "boolean" ? res.colors.partialBorderEnabled : false
        };
      }
    } catch (error) {
      // ignore, fall back to defaults
    }

    if (visitedToggle) visitedToggle.checked = colorsState.matchTextEnabled !== false;
    if (partialToggle) partialToggle.checked = colorsState.partialTextEnabled !== false;
    const visitedBorderToggle = document.getElementById("visited-border-toggle");
    const partialBorderToggle = document.getElementById("partial-border-toggle");
    if (visitedBorderToggle) visitedBorderToggle.checked = colorsState.matchBorderEnabled === true;
    if (partialBorderToggle) partialBorderToggle.checked = colorsState.partialBorderEnabled === true;
    setSwatchColor(visitedSwatch, colorsState.matchHexColor);
    setSwatchColor(partialSwatch, colorsState.partialHexColor);
    setLabelColor(visitedTextLabel, colorsState.matchHexColor);
    setLabelColor(partialTextLabel, colorsState.partialHexColor);
    setBorderLabel(visitedBorderLabel, colorsState.matchHexColor);
    setBorderLabel(partialBorderLabel, colorsState.partialHexColor);
  }

  async function saveColors(partialUpdate = {}) {
    colorsState = {
      ...colorsState,
      ...partialUpdate
    };
    try {
      await apiColors.runtime.sendMessage({
        type: "SET_LINK_COLORS",
        matchHexColor: colorsState.matchHexColor,
        partialHexColor: colorsState.partialHexColor,
        matchTextEnabled: colorsState.matchTextEnabled,
        partialTextEnabled: colorsState.partialTextEnabled,
        matchBorderEnabled: colorsState.matchBorderEnabled,
        partialBorderEnabled: colorsState.partialBorderEnabled
      });
    } catch (error) {
      // ignore save errors
    }
  }

  function ensurePicker() {
    if (picker) return picker;
    pickerPopover = document.createElement("div");
    pickerPopover.style.position = "absolute";
    pickerPopover.style.display = "none";
    pickerPopover.style.zIndex = "3000";
    pickerPopover.style.background = "#0f1826";
    pickerPopover.style.padding = "5px";
    pickerPopover.style.borderRadius = "12px";
    pickerPopover.style.boxShadow = "0 12px 30px rgba(0,0,0,0.45)";
    document.body.appendChild(pickerPopover);

    picker = new window.iro.ColorPicker(pickerPopover, {
      width: 150,
      color: colorsState.matchHexColor,
      layout: [
        { component: window.iro.ui.Wheel, options: { borderColor: "#1d2b3a" } },
        { component: window.iro.ui.Slider, options: { sliderType: "value" } }
      ]
    });

    picker.on("color:change", (color) => {
      if (!activeTarget) return;
      const hex = color.hexString;
      if (activeTarget === "match") {
        setSwatchColor(visitedSwatch, hex);
        setLabelColor(visitedTextLabel, hex);
        setBorderLabel(visitedBorderLabel, hex);
        saveColors({ matchHexColor: hex });
      } else if (activeTarget === "partial") {
        setSwatchColor(partialSwatch, hex);
        setLabelColor(partialTextLabel, hex);
        setBorderLabel(partialBorderLabel, hex);
        saveColors({ partialHexColor: hex });
      }
    });

    document.addEventListener("click", (event) => {
      if (!pickerPopover || pickerPopover.style.display === "none") return;
      if (pickerPopover.contains(event.target)) return;
      if (visitedSwatch && visitedSwatch.contains(event.target)) return;
      if (partialSwatch && partialSwatch.contains(event.target)) return;
      pickerPopover.style.display = "none";
      activeTarget = null;
    });

    return picker;
  }

  function showPickerFor(target, anchorEl, color) {
    const pickerInstance = ensurePicker();
    activeTarget = target;
    pickerInstance.color.hexString = color || "#000000";
    const rect = anchorEl.getBoundingClientRect();
    pickerPopover.style.visibility = "hidden";
    pickerPopover.style.display = "block";
    const pickerRect = pickerPopover.getBoundingClientRect();
    const pickerWidth = pickerRect.width || 220;
    const left = rect.left + window.scrollX - pickerWidth - 4;
    pickerPopover.style.left = `${Math.max(left, 8)}px`;
    pickerPopover.style.top = `${rect.top + window.scrollY}px`;
    pickerPopover.style.visibility = "visible";
  }

  function bindSwatch(swatchEl, targetKey) {
    if (!swatchEl) return;
    swatchEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const color =
        targetKey === "match" ? colorsState.matchHexColor : colorsState.partialHexColor;
      showPickerFor(targetKey, swatchEl, color);
    });
  }

  function bindToggle(toggleEl, targetKey) {
    if (!toggleEl) return;
    toggleEl.addEventListener("change", (event) => {
      const enabled = event.target.checked;
      if (targetKey === "match") {
        saveColors({ matchTextEnabled: enabled });
      } else if (targetKey === "partial") {
        saveColors({ partialTextEnabled: enabled });
      } else if (targetKey === "matchBorder") {
        saveColors({ matchBorderEnabled: enabled });
      } else if (targetKey === "partialBorder") {
        saveColors({ partialBorderEnabled: enabled });
      }
    });
  }

  loadColors().then(() => {
    bindSwatch(visitedSwatch, "match");
    bindSwatch(partialSwatch, "partial");
    bindToggle(visitedToggle, "match");
    bindToggle(partialToggle, "partial");
    bindToggle(document.getElementById("visited-border-toggle"), "matchBorder");
    bindToggle(document.getElementById("partial-border-toggle"), "partialBorder");
  });
})();
