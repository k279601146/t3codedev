// @effect-diagnostics nodeBuiltinImport:off
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_CLIENT_SETTINGS,
  DesktopWindowsSandboxFirewallRepairResultSchema,
  DesktopWindowsSandboxModeChangeInputSchema,
  DesktopWindowsSandboxModeChangeResultSchema,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const execFileAsync = promisify(execFile);
const REPAIR_TIMEOUT_MS = 120_000;
const BACKEND_WINDOWS_SANDBOX_RESTART_TIMEOUT = Duration.seconds(5);

class WindowsSandboxFirewallRepairError extends Data.TaggedError(
  "WindowsSandboxFirewallRepairError",
)<{
  readonly cause: unknown;
}> {}

function windowsPowerShellPath(): string {
  const systemRoot = process.env.SYSTEMROOT || process.env.windir || String.raw`C:\Windows`;
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

const SERVICE_REPAIR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$changed = $false

$bfe = Get-Service -Name BFE -ErrorAction Stop
if ($bfe.Status -ne 'Running') {
  Start-Service -Name BFE
  $changed = $true
}

$mps = Get-Service -Name MpsSvc -ErrorAction Stop
if ($mps.StartType -eq 'Disabled') {
  Set-Service -Name MpsSvc -StartupType Manual
  $changed = $true
}
if ($mps.Status -ne 'Running') {
  Start-Service -Name MpsSvc
  $changed = $true
}

(Get-Service -Name BFE).WaitForStatus('Running', [TimeSpan]::FromSeconds(10))
(Get-Service -Name MpsSvc).WaitForStatus('Running', [TimeSpan]::FromSeconds(10))

$bfe = Get-Service -Name BFE
$mps = Get-Service -Name MpsSvc
if ($bfe.Status -ne 'Running' -or $mps.Status -ne 'Running') {
  throw "Windows 防火墙依赖服务未能启动。BFE=$($bfe.Status), MpsSvc=$($mps.Status)"
}

if ($changed) {
  Write-Output 'repaired'
} else {
  Write-Output 'already-ready'
}
`;

function buildElevatedRepairLauncher(): string {
  const encodedRepairScript = encodePowerShellCommand(SERVICE_REPAIR_SCRIPT);
  return String.raw`
$ErrorActionPreference = 'Stop'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-EncodedCommand',
  '${encodedRepairScript}'
)
$process = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -Wait -PassThru -WindowStyle Hidden
if ($null -eq $process) {
  throw '管理员授权窗口未返回修复进程。'
}
exit $process.ExitCode
`;
}

function toRepairResult(input: {
  readonly success: boolean;
  readonly repaired: boolean;
  readonly message: string;
  readonly exitCode?: number | null;
}) {
  return input;
}

export const repairWindowsSandboxFirewall = makeIpcMethod({
  channel: IpcChannels.REPAIR_WINDOWS_SANDBOX_FIREWALL_CHANNEL,
  payload: Schema.Void,
  result: DesktopWindowsSandboxFirewallRepairResultSchema,
  handler: Effect.fn("desktop.ipc.windowsSandbox.repairFirewall")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "win32") {
      return toRepairResult({
        success: false,
        repaired: false,
        message: "当前系统不是 Windows，无需修复 Windows 防火墙服务。",
      });
    }

    const launcher = buildElevatedRepairLauncher();
    const encodedLauncher = encodePowerShellCommand(launcher);

    const runRepair = Effect.tryPromise({
      try: () =>
        execFileAsync(
          windowsPowerShellPath(),
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedLauncher],
          {
            timeout: REPAIR_TIMEOUT_MS,
            windowsHide: true,
          },
        ),
      catch: (cause) => new WindowsSandboxFirewallRepairError({ cause }),
    });

    return yield* runRepair.pipe(
      Effect.match({
        onSuccess: (result) => {
          const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
          const repaired = output.includes("repaired");
          const alreadyReady = output.includes("already-ready");
          return toRepairResult({
            success: true,
            repaired,
            message: repaired
              ? "已启动 Windows 防火墙服务。"
              : alreadyReady
                ? "Windows 防火墙服务已经可用。"
                : "Windows 防火墙服务已确认可用。",
            exitCode: 0,
          });
        },
        onFailure: (error) => {
          const maybeError = error.cause as {
            readonly code?: unknown;
            readonly signal?: unknown;
            readonly stdout?: unknown;
            readonly stderr?: unknown;
            readonly message?: unknown;
            readonly killed?: unknown;
          };
          const exitCode = typeof maybeError.code === "number" ? maybeError.code : null;
          const detail =
            typeof maybeError.stderr === "string" && maybeError.stderr.trim().length > 0
              ? maybeError.stderr.trim()
              : typeof maybeError.stdout === "string" && maybeError.stdout.trim().length > 0
                ? maybeError.stdout.trim()
                : typeof maybeError.message === "string"
                  ? maybeError.message
                  : "无法启动 Windows 防火墙服务。";
          const timedOut = maybeError.killed === true || maybeError.signal === "SIGTERM";
          return toRepairResult({
            success: false,
            repaired: false,
            message: timedOut
              ? "修复等待超时，请确认管理员授权窗口是否被遮挡。"
              : `无法修复 Windows 防火墙服务：${detail}`,
            exitCode,
          });
        },
      }),
    );
  }),
});

export const setWindowsSandboxMode = makeIpcMethod({
  channel: IpcChannels.SET_WINDOWS_SANDBOX_MODE_CHANNEL,
  payload: DesktopWindowsSandboxModeChangeInputSchema,
  result: DesktopWindowsSandboxModeChangeResultSchema,
  handler: Effect.fn("desktop.ipc.windowsSandbox.setMode")(function* (input) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    const currentSettings = Option.getOrElse(yield* clientSettings.get, () => DEFAULT_CLIENT_SETTINGS);
    const nextSettings = {
      ...currentSettings,
      windowsSandbox: {
        ...currentSettings.windowsSandbox,
        mode: input.mode,
        ...(input.elevatedSetupFallbackDismissed !== undefined
          ? { elevatedSetupFallbackDismissed: input.elevatedSetupFallbackDismissed }
          : {}),
        ...(input.elevatedSetupLastError !== undefined
          ? { elevatedSetupLastError: input.elevatedSetupLastError }
          : {}),
        ...(input.elevatedSetupLastAttemptedAt !== undefined
          ? { elevatedSetupLastAttemptedAt: input.elevatedSetupLastAttemptedAt }
          : {}),
      },
    };

    yield* clientSettings.set(nextSettings);
    yield* backendManager.stop({ timeout: BACKEND_WINDOWS_SANDBOX_RESTART_TIMEOUT });
    yield* backendManager.start;

    return {
      mode: input.mode,
      restarted: true,
    };
  }),
});
