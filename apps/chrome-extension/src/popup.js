const endpointInput = document.querySelector("#endpoint");
const tokenInput = document.querySelector("#token");
const statusText = document.querySelector("#status");
const errorText = document.querySelector("#error");
const saveButton = document.querySelector("#save");

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function refreshStatus() {
  const status = await sendMessage({ type: "getStatus" });
  endpointInput.value = status.endpoint || "";
  statusText.textContent = status.connected
    ? "已连接到 T3 Code"
    : status.hasToken
      ? "未连接，正在重试"
      : "等待配置";
  errorText.textContent = status.lastError || "";
}

saveButton.addEventListener("click", async () => {
  errorText.textContent = "";
  const response = await sendMessage({
    type: "saveConfig",
    endpoint: endpointInput.value.trim(),
    token: tokenInput.value.trim(),
  });
  if (!response?.ok) {
    errorText.textContent = response?.error || "保存失败";
    return;
  }
  tokenInput.value = "";
  await refreshStatus();
});

void refreshStatus();
