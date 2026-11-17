(function () {
  const SID = __SCREEN_ID__,
    ACCENT = "__ACCENT__";
  let mode = "select",
    presentation = false,
    picked = null,
    hover = null,
    handle = null,
    drag = null,
    preview = null,
    pickedElements = [];
  const outlines = new WeakMap();
  window.__pragnaScreenId = SID;
  const send = (type, data = {}) =>
    parent.postMessage(
      { source: "pragna-design", type, screenId: SID, ...data },
      "*",
    );
  function mark(el, on) {
    if (!el?.style) return;
    if (on) {
      if (!outlines.has(el))
        outlines.set(el, [el.style.outline, el.style.outlineOffset]);
      el.style.outline = "2px solid " + ACCENT;
      el.style.outlineOffset = "-2px";
    } else if (outlines.has(el)) {
      [el.style.outline, el.style.outlineOffset] = outlines.get(el);
      outlines.delete(el);
    }
  }
  function resetPreview() {
    if (preview) {
      preview.el.setAttribute("style", preview.style);
      preview = null;
    }
  }
  function clear() {
    resetPreview();
    mark(hover, false);
    pickedElements.forEach((el) => mark(el, false));
    pickedElements = [];
    mark(picked, false);
    hover = picked = null;
    handle?.remove();
    handle = null;
  }
  function path(el) {
    const parts = [];
    while (el && el !== document.body) {
      parts.unshift(
        el.tagName.toLowerCase() +
          ":nth-child(" +
          (Array.from(el.parentElement.children).indexOf(el) + 1) +
          ")",
      );
      el = el.parentElement;
    }
    return "body > " + parts.join(" > ");
  }
  function editable(el) {
    return (
      el.children.length === 0 &&
      ![
        "SCRIPT",
        "STYLE",
        "INPUT",
        "TEXTAREA",
        "IMG",
        "SVG",
        "PATH",
        "IFRAME",
        "VIDEO",
        "AUDIO",
        "CANVAS",
      ].includes(el.tagName)
    );
  }
  const hex = (value) => {
    const nums = value.match(/\d+/g);
    return nums?.length >= 3
      ? "#" +
          nums
            .slice(0, 3)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("")
      : "#000000";
  };
  function placeHandle() {
    if (!handle || !picked) return;
    const r = picked.getBoundingClientRect();
    Object.assign(handle.style, {
      left: r.right + scrollX - 7 + "px",
      top: r.bottom + scrollY - 7 + "px",
    });
  }
  function pick(el, additive = false) {
    if (
      !el ||
      el === document.body ||
      el === document.documentElement ||
      el.closest("[data-pragna-editor]")
    )
      return;
    const group = additive ? pickedElements.slice() : [];
    const index = group.indexOf(el);
    if (index >= 0) group.splice(index, 1);
    else group.push(el);
    clear();
    pickedElements = group;
    if (!group.length) return;
    picked = group[group.length - 1];
    el = picked;
    const css = getComputedStyle(el),
      styles = {};
    [
      "font-size",
      "padding",
      "gap",
      "border-radius",
      "text-align",
      "width",
      "height",
      "left",
      "top",
    ].forEach((key) => (styles[key] = css.getPropertyValue(key)));
    styles.color = hex(css.color);
    styles["background-color"] = hex(css.backgroundColor);
    send("select", {
      tag: el.tagName.toLowerCase(),
      html: el.outerHTML.slice(0, 6000),
      selector: path(el),
      text: el.textContent.trim().slice(0, 4000),
      canEdit: group.length === 1 && editable(el),
      styles,
      selectors: group.map(path),
    });
    group.forEach((item) => mark(item, true));
    handle = document.createElement("button");
    handle.dataset.pragnaEditor = "resize";
    handle.type = "button";
    handle.setAttribute("aria-label", "Resize selected element");
    Object.assign(handle.style, {
      position: "absolute",
      width: "14px",
      height: "14px",
      border: "2px solid white",
      background: ACCENT,
      zIndex: "2147483647",
      padding: "0",
      cursor: "nwse-resize",
    });
    document.body.append(handle);
    placeHandle();
  }
  document.addEventListener("mouseover", (e) => {
    if (mode !== "select" || e.target.closest("[data-pragna-editor]")) return;
    if (hover !== picked) mark(hover, false);
    hover = e.target;
    if (hover !== picked) mark(hover, true);
  });
  document.addEventListener("mouseleave", () => {
    if (hover !== picked) mark(hover, false);
    hover = null;
  });
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("[data-pragna-editor]")) {
        e.preventDefault();
        return;
      }
      if (mode === "preview") {
        const link = e.target.closest("a");
        if (
          link &&
          !e.defaultPrevented &&
          !link.hasAttribute("data-design-action")
        ) {
          const href = link.getAttribute("href") || "";
          if (
            !href ||
            href === "#" ||
            (href.startsWith("#") && document.getElementById(href.slice(1)))
          )
            return;
          e.preventDefault();
          send("navigate", { href, label: link.textContent.trim() });
        }
        return;
      }
      if (e.target.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      pick(e.target, e.ctrlKey || e.metaKey);
    },
    true,
  );
  document.addEventListener(
    "dblclick",
    (e) => {
      if (mode !== "select" || !editable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      pick(e.target);
      const el = picked,
        selector = path(el),
        original = el.textContent;
      el.contentEditable = "true";
      el.focus();
      const done = () => {
        el.contentEditable = "false";
        const text = el.textContent;
        el.textContent = original;
        if (text !== original) send("text-edit", { selector, text });
      };
      el.addEventListener("blur", done, { once: true });
      el.addEventListener("keydown", function key(event) {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          if (event.key === "Escape") el.textContent = original;
          el.blur();
          el.removeEventListener("keydown", key);
        }
      });
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (mode !== "select" || !picked || (!e.altKey && e.target !== handle))
        return;
      e.preventDefault();
      e.stopPropagation();
      const css = getComputedStyle(picked),
        r = picked.getBoundingClientRect();
      drag = {
        x: e.clientX,
        y: e.clientY,
        kind: e.target === handle ? "resize" : "move",
        selector: path(picked),
        width: r.width,
        height: r.height,
        left: parseFloat(css.left) || 0,
        top: parseFloat(css.top) || 0,
        original: picked.getAttribute("style") || "",
        changes: {},
      };
    },
    true,
  );
  document.addEventListener("pointermove", (e) => {
    if (!drag || !picked) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    drag.changes =
      drag.kind === "resize"
        ? {
            width: Math.round(Math.max(20, drag.width + dx)) + "px",
            height: Math.round(Math.max(20, drag.height + dy)) + "px",
          }
        : {
            position: "relative",
            left: Math.round(drag.left + dx) + "px",
            top: Math.round(drag.top + dy) + "px",
          };
    Object.entries(drag.changes).forEach(([k, v]) =>
      picked.style.setProperty(k, v),
    );
    placeHandle();
  });
  document.addEventListener("pointerup", () => {
    if (!drag || !picked) return;
    const action = drag;
    drag = null;
    picked.setAttribute("style", action.original);
    mark(picked, true);
    placeHandle();
    if (Object.keys(action.changes).length)
      send("canvas-change", {
        selector: action.selector,
        styles: action.changes,
      });
  });
  document.addEventListener("keydown", (e) => {
    if (
      presentation &&
      !e.target.closest("input,textarea,select,[contenteditable=true]")
    ) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        send("presentation-step", { delta: e.key === "ArrowRight" ? 1 : -1 });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        send("presentation-close");
        return;
      }
    }
    if (
      mode !== "select" ||
      e.target.isContentEditable ||
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
    )
      return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      send("history-command", { redo: e.shiftKey });
      return;
    }
    if (!picked) return;
    let operation = null;
    if (mod && e.key.toLowerCase() === "d") operation = "duplicate";
    if (e.key === "Delete" || e.key === "Backspace") operation = "delete";
    if (mod && e.key.toLowerCase() === "g")
      operation = e.shiftKey ? "ungroup" : "group";
    if (e.shiftKey && e.key.toLowerCase() === "h")
      operation = "flip-horizontal";
    if (e.shiftKey && e.key.toLowerCase() === "v") operation = "flip-vertical";
    if (operation) {
      e.preventDefault();
      send("canvas-command", {
        operation,
        selector: path(picked),
        selectors: pickedElements.map(path),
      });
    }
  });
  document.addEventListener("submit", (e) => {
    e.preventDefault();
  });
  window.addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.type === "clear") clear();
    if (m.type === "mode") {
      clear();
      presentation = m.mode === "presentation";
      mode = m.mode === "preview" || presentation ? "preview" : "select";
    }
    if (m.type === "select-selector") {
      try {
        pick(document.querySelector(m.selector));
        picked?.scrollIntoView({ block: "nearest" });
      } catch {}
    }
    if (m.type === "style-preview" && picked) {
      resetPreview();
      if (m.styles) {
        preview = { el: picked, style: picked.getAttribute("style") || "" };
        Object.entries(m.styles).forEach(([k, v]) =>
          picked.style.setProperty(k, v),
        );
      }
      placeHandle();
    }
    if (m.type === "capture") {
      clear();
      const capture = () =>
        window.htmlToImage
          .toPng(document.body, { pixelRatio: 2 })
          .then((url) => send("png", { url }))
          .catch((err) => send("png-error", { error: String(err) }));
      if (window.htmlToImage) capture();
      else {
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
        script.onload = capture;
        script.onerror = () =>
          send("png-error", { error: "Could not load the image exporter" });
        document.head.append(script);
      }
    }
  });
  let errors = 0;
  const report = (error) => {
    if (errors++ < 5)
      send("runtime-error", { error: String(error).slice(0, 500) });
  };
  window.addEventListener("error", (e) => {
    if (e.message) report(e.message);
  });
  window.addEventListener("unhandledrejection", (e) =>
    report(e.reason?.message || e.reason),
  );
  document.addEventListener("DOMContentLoaded", () => send("ready"));
})();
