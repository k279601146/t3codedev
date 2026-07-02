import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultEngineName = process.platform === "win32" ? "ai-engine.exe" : "ai-engine";

export function getDefaultEnginePath(repoRoot) {
  return path.join(repoRoot, "apps", "desktop", "bin", defaultEngineName);
}

export function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function connectWebSocket(url, timeoutMs) {
  if (typeof WebSocket !== "function") {
    throw new Error("当前 Node.js 没有全局 WebSocket，请使用 Node 22+。");
  }

  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(url);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          reject(new Error("连接超时"));
        }, 500);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        ws.addEventListener(
          "error",
          (event) => {
            clearTimeout(timer);
            reject(event.error ?? new Error("WebSocket 连接失败"));
          },
          { once: true },
        );
      });
      return ws;
    } catch (error) {
      lastError = error;
      await wait(150);
    }
  }
  throw lastError ?? new Error("无法连接 ai-engine WebSocket");
}

function readMessageText(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
}

export class JsonRpcClient {
  #nextId = 1;
  #pending = new Map();
  #timeoutMs;
  #ws;

  constructor(ws, timeoutMs) {
    this.#ws = ws;
    this.#timeoutMs = timeoutMs;

    ws.addEventListener("message", (event) => {
      const text = readMessageText(event.data);
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (message?.id === undefined || !this.#pending.has(message.id)) return;
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      pending.resolve(message);
    });

    ws.addEventListener("error", (event) => {
      this.#rejectPending(event.error ?? new Error("WebSocket 读取失败"));
    });

    ws.addEventListener("close", () => {
      this.#rejectPending(new Error("ai-engine WebSocket 已关闭"));
    });
  }

  notify(method, params = {}) {
    this.#ws.send(JSON.stringify({ method, params }));
  }

  requestRaw(method, params = {}, timeoutMs = this.#timeoutMs) {
    const id = this.#nextId;
    this.#nextId += 1;
    const response = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(response, timeoutMs, `等待 ${method} 响应`).finally(() => {
      this.#pending.delete(id);
    });
  }

  async request(method, params = {}, timeoutMs = this.#timeoutMs) {
    const response = await this.requestRaw(method, params, timeoutMs);
    if (response?.error) {
      const message = response.error.message ?? JSON.stringify(response.error);
      throw new Error(`${method}: ${message}`);
    }
    return response?.result;
  }

  close() {
    try {
      this.#ws.close();
    } catch {}
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), wait(1_500)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit"), wait(1_500)]);
  }
}

export async function withAiEngineRpc(options, run) {
  const port = options.port ?? 48_000 + Math.floor(Math.random() * 1_000);
  const url = `ws://127.0.0.1:${port}`;
  const probeHome = path.join(options.repoRoot, ".tmp", `${options.homePrefix}-${randomUUID()}`);
  mkdirSync(probeHome, { recursive: true });

  const stderrLines = [];
  const child = spawn(options.enginePath, ["--listen", url], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      CODEX_HOME: probeHome,
      CODEX_DISABLE_TELEMETRY: "true",
    },
    windowsHide: true,
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      stderrLines.push(trimmed);
      if (options.verbose) console.error(trimmed);
    }
  });

  let client;
  try {
    const ws = await connectWebSocket(url, options.timeoutMs);
    client = new JsonRpcClient(ws, options.timeoutMs);
    const initializeResult = await client.request("initialize", {
      clientInfo: options.clientInfo,
      capabilities: {
        experimentalApi: true,
      },
    });
    client.notify("initialized");
    return await run({ client, url, probeHome, stderrLines, initializeResult });
  } catch (error) {
    if (error instanceof Error) {
      error.stderrLines = stderrLines;
      error.probeHome = probeHome;
    }
    throw error;
  } finally {
    client?.close();
    await stopChild(child);
    try {
      rmSync(probeHome, { recursive: true, force: true, maxRetries: os.platform() === "win32" ? 3 : 0 });
    } catch {}
  }
}
