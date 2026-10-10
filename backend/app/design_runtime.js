/* Local prototype controls. Included in previews and standalone HTML exports. */
(function () {
  "use strict";
  var returnFocus = new WeakMap();
  var filterState = new WeakMap();
  function find(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }
  function visible(target, show) {
    if (!target) return;
    target.hidden = !show;
    target.setAttribute("aria-hidden", String(!show));
  }
  function filter(list, query, category) {
    if (!list) return;
    var state = filterState.get(list) || { query: "", category: "all" };
    if (category) state.category = query;
    else state.query = query.toLowerCase();
    filterState.set(list, state);
    var count = 0;
    list.querySelectorAll("[data-design-item]").forEach(function (item) {
      var match =
        (state.category === "all" ||
          item.getAttribute("data-design-category") === state.category) &&
        item.textContent.toLowerCase().indexOf(state.query) !== -1;
      visible(item, match);
      if (match) count++;
    });
    list.querySelectorAll("[data-design-empty]").forEach(function (item) {
      visible(item, count === 0);
    });
  }
  document.addEventListener("click", function (event) {
    var control = event.target.closest("[data-design-action]");
    if (!control || control.disabled || event.defaultPrevented) return;
    var action = control.getAttribute("data-design-action");
    var target = find(control.getAttribute("data-design-target"));
    event.preventDefault();
    if (action === "tab" && target) {
      var group = control.closest("[data-design-tabs]");
      if (!group || !group.contains(target)) return;
      group.querySelectorAll("[data-design-panel]").forEach(function (panel) {
        if (panel.closest("[data-design-tabs]") === group)
          visible(panel, panel === target);
      });
      group
        .querySelectorAll('[data-design-action="tab"]')
        .forEach(function (tab) {
          if (tab.closest("[data-design-tabs]") !== group) return;
          var active = tab === control;
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
        });
    } else if (action === "toggle" || action === "show" || action === "hide") {
      if (!target) return;
      var show = action === "show" || (action === "toggle" && target.hidden);
      visible(target, show);
      document
        .querySelectorAll("[data-design-target]")
        .forEach(function (button) {
          if (
            button.getAttribute("data-design-target") ===
            control.getAttribute("data-design-target")
          ) {
            button.setAttribute("aria-expanded", String(show));
          }
        });
    } else if (
      action === "open-dialog" &&
      target &&
      target.tagName === "DIALOG"
    ) {
      returnFocus.set(target, control);
      target.showModal();
    } else if (action === "close-dialog") {
      var dialog = target || control.closest("dialog");
      if (dialog && dialog.tagName === "DIALOG") dialog.close();
    } else if (action === "filter") {
      filter(target, control.getAttribute("data-design-value") || "all", true);
      var filters = control.closest("[data-design-filters]");
      if (filters)
        filters
          .querySelectorAll('[data-design-action="filter"]')
          .forEach(function (button) {
            button.setAttribute("aria-pressed", String(button === control));
          });
    } else if (action === "toast") {
      var status = document.getElementById("design-demo-status");
      if (!status) {
        status = document.createElement("div");
        status.id = "design-demo-status";
        status.setAttribute("role", "status");
        status.className =
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-theme bg-foreground text-background px-5 py-3 shadow-lg text-sm";
        document.body.appendChild(status);
      }
      status.textContent =
        control.getAttribute("data-design-message") || "Demo action complete";
      status.hidden = false;
      clearTimeout(status._hideTimer);
      status._hideTimer = setTimeout(function () {
        status.hidden = true;
      }, 4000);
    }
  });
  var pendingAI = new Map();
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.hasAttribute("data-design-ai")) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    var target = find(form.getAttribute("data-design-ai"));
    if (!target) return;
    target.hidden = false;
    target.setAttribute("role", "status");
    if (!window.__pragnaScreenId || parent === window) {
      target.textContent =
        "Open this prototype in Pragna and enable AI demo to use its assistant.";
      return;
    }
    var input = form.querySelector('[name="prompt"]');
    var prompt = input
      ? input.value
      : Array.from(new FormData(form).values())
          .filter((value) => typeof value === "string")
          .join(" ");
    if (!prompt.trim()) return;
    var requestId =
      "ai-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    target.textContent = "Thinking…";
    form.setAttribute("aria-busy", "true");
    var timer = setTimeout(function () {
      pendingAI.delete(requestId);
      form.removeAttribute("aria-busy");
      target.textContent = "AI demo timed out. Try again.";
    }, 40000);
    pendingAI.set(requestId, { target: target, form: form, timer: timer });
    parent.postMessage(
      {
        source: "pragna-design",
        type: "ai-request",
        screenId: window.__pragnaScreenId,
        requestId: requestId,
        prompt: prompt.slice(0, 2000),
      },
      "*",
    );
  });
  window.addEventListener("message", function (event) {
    if (event.source !== parent || event.data?.type !== "ai-response") return;
    var pending = pendingAI.get(event.data.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingAI.delete(event.data.requestId);
    pending.form.removeAttribute("aria-busy");
    pending.target.textContent = String(
      event.data.content || "No answer received.",
    );
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-design-speak]");
    if (!button || event.defaultPrevented) return;
    event.preventDefault();
    var target = find(button.getAttribute("data-design-speak"));
    if (!target) return;
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(
        new SpeechSynthesisUtterance(target.textContent.slice(0, 4000)),
      );
    } else {
      target.setAttribute("role", "status");
      target.textContent = "Voice playback is unavailable in this browser.";
    }
  });
  var pendingVoice = new Map();
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-design-dictate]");
    if (!button || event.defaultPrevented) return;
    event.preventDefault();
    var target = find(button.getAttribute("data-design-dictate"));
    if (!target || !("value" in target)) return;
    var requestId = "voice-" + Date.now();
    pendingVoice.set(requestId, target);
    button.setAttribute("aria-busy", "true");
    var timer = setTimeout(function () {
      button.removeAttribute("aria-busy");
      pendingVoice.delete(requestId);
    }, 16000);
    target._voiceControl = { button: button, timer: timer };
    if (window.__pragnaScreenId && parent !== window) {
      parent.postMessage(
        {
          source: "pragna-design",
          type: "voice-request",
          screenId: window.__pragnaScreenId,
          requestId: requestId,
        },
        "*",
      );
    } else {
      button.removeAttribute("aria-busy");
      clearTimeout(timer);
      pendingVoice.delete(requestId);
      var status = document.createElement("span");
      status.setAttribute("role", "status");
      status.textContent = "Open this prototype in Pragna for voice input.";
      button.after(status);
    }
  });
  window.addEventListener("message", function (event) {
    if (event.source !== parent || event.data?.type !== "voice-response")
      return;
    var target = pendingVoice.get(event.data.requestId);
    if (!target) return;
    pendingVoice.delete(event.data.requestId);
    clearTimeout(target._voiceControl.timer);
    target._voiceControl.button.removeAttribute("aria-busy");
    if (event.data.error) {
      var status = document.createElement("span");
      status.setAttribute("role", "status");
      status.textContent = String(event.data.content);
      target._voiceControl.button.after(status);
    } else {
      target.value = String(event.data.content).slice(0, 4000);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.focus();
    }
  });
  document.addEventListener("input", function (event) {
    var input = event.target;
    if (input.hasAttribute("data-design-filter"))
      filter(
        find(input.getAttribute("data-design-filter")),
        input.value,
        false,
      );
    var output = find(input.getAttribute("data-design-output"));
    if (output) output.textContent = input.value;
  });
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.hasAttribute("data-design-submit")) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    var result = find(form.getAttribute("data-design-submit"));
    if (result) {
      visible(result, true);
      result.setAttribute("role", "status");
      result.textContent =
        form.getAttribute("data-design-success") || "Saved in this demo.";
    }
  });
  document.addEventListener("keydown", function (event) {
    var control = event.target.closest('[data-design-action="tab"]');
    if (
      !control ||
      ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1
    )
      return;
    var group = control.closest("[data-design-tabs]");
    if (!group) return;
    var tabs = Array.from(
      group.querySelectorAll('[data-design-action="tab"]'),
    ).filter(function (tab) {
      return !tab.disabled && tab.closest("[data-design-tabs]") === group;
    });
    var index = tabs.indexOf(control);
    if (!tabs.length) return;
    index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
            tabs.length;
    event.preventDefault();
    tabs[index].click();
    tabs[index].focus();
  });
  function init() {
    document.querySelectorAll("[data-design-tabs]").forEach(function (group) {
      var tabs = Array.from(
        group.querySelectorAll('[data-design-action="tab"]'),
      ).filter(function (tab) {
        return tab.closest("[data-design-tabs]") === group;
      });
      var active =
        tabs.find(function (tab) {
          return tab.getAttribute("aria-selected") === "true";
        }) || tabs[0];
      if (!active) return;
      tabs.forEach(function (tab) {
        tab.setAttribute("aria-selected", String(tab === active));
        tab.tabIndex = tab === active ? 0 : -1;
      });
      var target = find(active.getAttribute("data-design-target"));
      if (target)
        group.querySelectorAll("[data-design-panel]").forEach(function (panel) {
          if (panel.closest("[data-design-tabs]") === group)
            visible(panel, panel === target);
        });
    });
    document.querySelectorAll("[data-design-output]").forEach(function (input) {
      var output = find(input.getAttribute("data-design-output"));
      if (output) output.textContent = input.value;
    });
    document.querySelectorAll("dialog").forEach(function (dialog) {
      dialog.addEventListener("close", function () {
        var control = returnFocus.get(dialog);
        if (control) control.focus();
      });
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
