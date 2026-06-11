const MAX_TEXT_LENGTH = 60000;
const DANGEROUS_READ_PATTERN =
  /\b(cookie|localStorage|sessionStorage|indexedDB|password|credential|navigator\.credentials)\b/i;
const RISKY_ACTION_TEXT_PATTERN =
  /\b(pay|purchase|buy|checkout|submit|send|delete|remove|archive|transfer|confirm|authorize|permission|upload)\b/i;

const shouldRegisterT3CodeListener = globalThis.__t3CodeContentScriptLoaded !== true;
globalThis.__t3CodeContentScriptLoaded = true;
globalThis.__t3CodeConsoleLogs = Array.isArray(globalThis.__t3CodeConsoleLogs)
  ? globalThis.__t3CodeConsoleLogs
  : [];

function pushConsoleLog(level, values) {
  globalThis.__t3CodeConsoleLogs.push({
    level,
    message: values
      .map((value) => {
        try {
          return typeof value === "string" ? value : JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(" "),
    url: location.href,
    line: 0,
    timestamp: new Date().toISOString(),
  });
  if (globalThis.__t3CodeConsoleLogs.length > 500) {
    globalThis.__t3CodeConsoleLogs.splice(0, globalThis.__t3CodeConsoleLogs.length - 500);
  }
}

if (shouldRegisterT3CodeListener) {
  for (const level of ["debug", "info", "log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      pushConsoleLog(level, values);
      original(...values);
    };
  }
  window.addEventListener("error", (event) => {
    pushConsoleLog("error", [event.message]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    pushConsoleLog("error", [event.reason]);
  });
}

function truncateText(text, maxLength = MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

function selectorFor(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
    let part = node.tagName.toLowerCase();
    if (node.name) part += `[name='${CSS.escape(node.name)}']`;
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${[...parent.children].indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function textForElement(element) {
  return (
    element.innerText ||
    element.value ||
    element.getAttribute("aria-label") ||
    element.placeholder ||
    element.name ||
    element.id ||
    ""
  )
    .trim()
    .replace(/\s+/g, " ");
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= innerHeight &&
    rect.left <= innerWidth
  );
}

function domSnapshot() {
  const lines = [];
  const title = document.title || "";
  const url = location.href;
  const text = (document.body?.innerText || "").replace(/\s+\n/g, "\n").trim();
  lines.push(`Title: ${title}`);
  lines.push(`URL: ${url}`);
  if (text) lines.push(`\nText:\n${text.slice(0, 45000)}`);
  const elements = [
    ...document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]"),
  ].slice(0, 250);
  if (elements.length) {
    lines.push("\nInteractive elements:");
    for (const element of elements) {
      if (!isVisible(element)) continue;
      const tag = element.tagName.toLowerCase();
      const label = textForElement(element);
      lines.push(`- ${tag} ${selectorFor(element)}${label ? ` :: ${label.slice(0, 160)}` : ""}`);
    }
  }
  return lines.join("\n");
}

function visibleDom() {
  return [
    ...document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]"),
  ]
    .map((element) => {
      if (!isVisible(element)) return null;
      const rect = element.getBoundingClientRect();
      return {
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: textForElement(element).slice(0, 200),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })
    .filter(Boolean)
    .slice(0, 300);
}

function inspectRisk(selector) {
  const element = selector ? document.querySelector(selector) : document.activeElement;
  if (!element) return { risky: false, reason: "No target element." };
  const text = textForElement(element);
  const type = (element.getAttribute("type") || "").toLowerCase();
  const role = (element.getAttribute("role") || "").toLowerCase();
  const tag = element.tagName.toLowerCase();
  const form = element.closest("form");
  const risky =
    type === "submit" ||
    type === "file" ||
    role === "button" ||
    tag === "button" ||
    Boolean(text.match(RISKY_ACTION_TEXT_PATTERN)) ||
    (form && (type === "text" || tag === "textarea" || tag === "select"));
  return { risky, text, tag, type, role, inForm: Boolean(form) };
}

function elementPoint(selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  element.scrollIntoView({ block: "center", inline: "center" });
  if (!isVisible(element)) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

if (shouldRegisterT3CodeListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (!message || message.source !== "t3code") return false;
    switch (message.type) {
      case "domSnapshot":
        sendResponse({ ok: true, value: truncateText(domSnapshot()) });
        return true;
      case "visibleDom":
        sendResponse({ ok: true, value: visibleDom() });
        return true;
      case "inspectRisk":
        sendResponse({ ok: true, value: inspectRisk(message.selector) });
        return true;
      case "click": {
        let x = message.x;
        let y = message.y;
        if (message.selector) {
          const point = elementPoint(message.selector);
          if (!point) throw new Error(`Element not found or not visible: ${message.selector}`);
          x = point.x;
          y = point.y;
        }
        const target = document.elementFromPoint(x, y);
        if (!target) throw new Error("No element at click point.");
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
        sendResponse({ ok: true, value: `Clicked ${Math.round(x)},${Math.round(y)}` });
        return true;
      }
      case "fill": {
        const element = document.querySelector(message.selector);
        if (!element) throw new Error(`Element not found: ${message.selector}`);
        element.focus();
        element.value = message.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        sendResponse({ ok: true, value: "Filled element." });
        return true;
      }
      case "type": {
        const element = message.selector ? document.querySelector(message.selector) : document.activeElement;
        if (!element) throw new Error("No target element for typing.");
        element.focus();
        document.execCommand("insertText", false, message.text);
        sendResponse({ ok: true, value: "Typed text." });
        return true;
      }
      case "press": {
        const eventInit = { bubbles: true, cancelable: true, key: message.key };
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        sendResponse({ ok: true, value: `Pressed ${message.key}.` });
        return true;
      }
      case "evaluateReadonly": {
        if (DANGEROUS_READ_PATTERN.test(message.expression || "")) {
          throw new Error("Reading cookies, storage, credentials, or password data is not allowed.");
        }
        const value = Function(`"use strict"; return (${message.expression});`)();
        sendResponse({ ok: true, value: truncateText(JSON.stringify(value, null, 2)) });
        return true;
      }
      case "consoleLogs": {
        const limit = Number.isFinite(message.limit) ? Math.max(1, Math.min(500, message.limit)) : 100;
        sendResponse({ ok: true, value: globalThis.__t3CodeConsoleLogs.slice(-limit) });
        return true;
      }
      default:
        sendResponse({ ok: false, error: `Unsupported content command: ${message.type}` });
        return true;
    }
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
});
