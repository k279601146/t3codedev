const STORAGE_KEYS = {
  endpoint: "t3Endpoint",
  token: "t3Token",
};
const T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX = "T3_BROWSER_CONFIRMATION_REQUIRED:";
const state = {
  connected: false,
  lastError: null,
  selectedTabId: null,
  polling: false,
};

function textResponse(text, success = true) {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function imageResponse(imageUrl, text) {
  return {
    success: true,
    contentItems: [
      { type: "inputImage", imageUrl },
      ...(text ? [{ type: "inputText", text }] : []),
    ],
  };
}

async function getConfig() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.endpoint, STORAGE_KEYS.token]);
  return {
    endpoint: String(values[STORAGE_KEYS.endpoint] || "").replace(/\/$/, ""),
    token: String(values[STORAGE_KEYS.token] || ""),
  };
}

async function postJson(path, body) {
  const { endpoint, token } = await getConfig();
  if (!endpoint || !token) throw new Error("请先在扩展弹窗中配置 Bahew endpoint 和 token。");
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(payload?.error || `Bahew 返回 HTTP ${response.status}`);
  }
  return payload;
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => ({
    id: String(tab.id),
    title: tab.title || "",
    url: tab.url || "",
    visible: tab.active === true,
    width: tab.width || 0,
    height: tab.height || 0,
    canGoBack: false,
    canGoForward: false,
  }));
}

async function publishState() {
  const tabs = await listTabs();
  const active = tabs.find((tab) => tab.visible) ?? tabs[0] ?? null;
  state.selectedTabId = active?.id ?? state.selectedTabId;
  await postJson("/extension/state", {
    extensionId: chrome.runtime.id,
    browserName: "Google Chrome",
    profileName: null,
    selectedTabId: state.selectedTabId,
    tabs,
  });
}

async function ensureContentScript(tabId) {
  const [{ result: alreadyLoaded } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__t3CodeContentScriptLoaded === true,
  });
  if (alreadyLoaded) {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"],
  });
}

async function sendContentCommand(tabId, message) {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    source: "t3code",
    ...message,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Chrome content script failed.");
  }
  return response.value;
}

function readArgs(payload) {
  return payload && typeof payload.arguments === "object" && payload.arguments !== null
    ? payload.arguments
    : {};
}

async function getTargetTab(tabId) {
  const id = tabId ? Number(tabId) : state.selectedTabId ? Number(state.selectedTabId) : undefined;
  if (id) {
    const tab = await chrome.tabs.get(id);
    if (tab?.id) return tab;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id) return active;
  const [first] = await chrome.tabs.query({});
  if (first?.id) return first;
  throw new Error("没有可用的 Chrome 标签页。");
}

function normalizeUrl(input) {
  const trimmed = String(input || "").trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") || trimmed.startsWith("[::1]")) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

async function handleToolCall(payload) {
  const args = readArgs(payload);
  switch (payload.tool) {
    case "browser_new_tab": {
      const tab = await chrome.tabs.create({
        url: args.url ? normalizeUrl(args.url) : "about:blank",
        active: true,
      });
      state.selectedTabId = String(tab.id);
      await publishState();
      return textResponse(`Created Chrome tab ${tab.id}.`);
    }
    case "browser_list_tabs": {
      await publishState();
      return textResponse(JSON.stringify(await listTabs(), null, 2));
    }
    case "browser_select_tab": {
      const tabId = Number(args.tabId);
      await chrome.tabs.update(tabId, { active: true });
      state.selectedTabId = String(tabId);
      await publishState();
      return textResponse(`Selected Chrome tab ${tabId}.`);
    }
    case "browser_close_tab": {
      await chrome.tabs.remove(Number(args.tabId));
      await publishState();
      return textResponse(`Closed Chrome tab ${args.tabId}.`);
    }
    case "browser_goto": {
      const tab = await getTargetTab(args.tabId);
      await chrome.tabs.update(tab.id, { url: normalizeUrl(args.url), active: true });
      state.selectedTabId = String(tab.id);
      await publishState();
      return textResponse(`Navigated Chrome tab ${tab.id} to ${normalizeUrl(args.url)}.`);
    }
    case "browser_reload": {
      const tab = await getTargetTab(args.tabId);
      await chrome.tabs.reload(tab.id);
      return textResponse(`Reloaded Chrome tab ${tab.id}.`);
    }
    case "browser_back": {
      const tab = await getTargetTab(args.tabId);
      await chrome.tabs.goBack(tab.id);
      return textResponse(`Went back in Chrome tab ${tab.id}.`);
    }
    case "browser_forward": {
      const tab = await getTargetTab(args.tabId);
      await chrome.tabs.goForward(tab.id);
      return textResponse(`Went forward in Chrome tab ${tab.id}.`);
    }
    case "browser_title": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(tab.title || "");
    }
    case "browser_url": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(tab.url || "");
    }
    case "browser_dom_snapshot": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(await sendContentCommand(tab.id, { type: "domSnapshot" }));
    }
    case "browser_visible_dom": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(JSON.stringify(await sendContentCommand(tab.id, { type: "visibleDom" }), null, 2));
    }
    case "browser_click": {
      const tab = await getTargetTab(args.tabId);
      const risk = await sendContentCommand(tab.id, {
        type: "inspectRisk",
        selector: args.selector,
      });
      if (risk?.risky && args.t3UserConfirmed !== true && args.userConfirmed !== true) {
        return textResponse(
          `${T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX}browser_use_external wants to click ${risk.text || risk.tag || "a page control"}.`,
          false,
        );
      }
      const value = await sendContentCommand(tab.id, {
        type: "click",
        selector: args.selector,
        x: args.x,
        y: args.y,
      });
      return textResponse(value);
    }
    case "browser_fill": {
      const tab = await getTargetTab(args.tabId);
      const risk = await sendContentCommand(tab.id, {
        type: "inspectRisk",
        selector: args.selector,
      });
      if (risk?.risky && args.t3UserConfirmed !== true && args.userConfirmed !== true) {
        return textResponse(
          `${T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX}browser_use_external wants to fill a form field on this page.`,
          false,
        );
      }
      return textResponse(
        await sendContentCommand(tab.id, {
          type: "fill",
          selector: args.selector,
          value: args.value,
        }),
      );
    }
    case "browser_type": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(
        await sendContentCommand(tab.id, {
          type: "type",
          selector: args.selector,
          text: args.text,
        }),
      );
    }
    case "browser_press": {
      const tab = await getTargetTab(args.tabId);
      const risk = await sendContentCommand(tab.id, {
        type: "inspectRisk",
        selector: args.selector,
      });
      if (
        risk?.risky &&
        String(args.key).toLowerCase() === "enter" &&
        args.t3UserConfirmed !== true &&
        args.userConfirmed !== true
      ) {
        return textResponse(
          `${T3_BROWSER_CONFIRMATION_REQUIRED_PREFIX}browser_use_external wants to press Enter in a form or button context.`,
          false,
        );
      }
      return textResponse(
        await sendContentCommand(tab.id, {
          type: "press",
          selector: args.selector,
          key: args.key,
        }),
      );
    }
    case "browser_screenshot": {
      const tab = await getTargetTab(args.tabId);
      await chrome.tabs.update(tab.id, { active: true });
      const imageUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return imageResponse(imageUrl, `Captured Chrome screenshot for tab ${tab.id}.`);
    }
    case "browser_console_logs":
      const tab = await getTargetTab(args.tabId);
      return textResponse(
        JSON.stringify(
          await sendContentCommand(tab.id, {
            type: "consoleLogs",
            limit: args.limit,
          }),
          null,
          2,
        ),
      );
    case "browser_evaluate_readonly": {
      const tab = await getTargetTab(args.tabId);
      return textResponse(
        await sendContentCommand(tab.id, {
          type: "evaluateReadonly",
          expression: args.expression,
        }),
      );
    }
    case "browser_set_viewport":
    case "browser_reset_viewport":
    case "browser_set_visibility":
      return textResponse(`${payload.tool} is not supported for external Chrome in v1.`, false);
    default:
      return textResponse(`Unsupported external browser tool: ${payload.tool}`, false);
  }
}

async function pollLoop() {
  if (state.polling) return;
  state.polling = true;
  while (state.polling) {
    try {
      const tabs = await listTabs();
      const active = tabs.find((tab) => tab.visible) ?? tabs[0] ?? null;
      const response = await postJson("/extension/poll", {
        extensionId: chrome.runtime.id,
        browserName: "Google Chrome",
        profileName: null,
        selectedTabId: active?.id ?? null,
        tabs,
      });
      state.connected = true;
      state.lastError = null;
      for (const command of response.commands || []) {
        if (command.type !== "tool/call") continue;
        let result;
        try {
          result = await handleToolCall(command.payload);
        } catch (error) {
          result = textResponse(error instanceof Error ? error.message : String(error), false);
        }
        await postJson("/extension/result", { id: command.id, result });
      }
    } catch (error) {
      state.connected = false;
      state.lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function registerAndPoll() {
  try {
    await postJson("/extension/register", {
      extensionId: chrome.runtime.id,
      browserName: "Google Chrome",
      profileName: null,
      selectedTabId: null,
      tabs: await listTabs(),
    });
    state.connected = true;
    state.lastError = null;
  } catch (error) {
    state.connected = false;
    state.lastError = error instanceof Error ? error.message : String(error);
  }
  void pollLoop();
}

chrome.runtime.onInstalled.addListener(() => {
  void registerAndPoll();
});
chrome.runtime.onStartup.addListener(() => {
  void registerAndPoll();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.endpoint] || changes[STORAGE_KEYS.token]) {
    state.polling = false;
    setTimeout(() => void registerAndPoll(), 100);
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getStatus") {
    void getConfig().then((config) =>
      sendResponse({
        connected: state.connected,
        lastError: state.lastError,
        endpoint: config.endpoint,
        hasToken: Boolean(config.token),
      }),
    );
    return true;
  }
  if (message?.type === "saveConfig") {
    void chrome.storage.local
      .set({
        [STORAGE_KEYS.endpoint]: message.endpoint,
        [STORAGE_KEYS.token]: message.token,
      })
      .then(() => registerAndPoll())
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  return false;
});

void registerAndPoll();
