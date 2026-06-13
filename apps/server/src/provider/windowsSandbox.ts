// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";
import { existsSync } from "node:fs";

import type {
  ServerProviderWindowsSandbox,
  WindowsSandboxMode,
  WindowsSandboxReadinessStatus,
} from "@t3tools/contracts";
import {
  resolveCommercialEngineWindowsSandboxMode,
  type CommercialEngineWindowsSandboxMode,
} from "@t3tools/shared/commercialEngine";

import { resolveBundledEngineConfig } from "./BundledEngineConfig.ts";

const COMMAND_RUNNER_NAMES = [
  "codex-command-runner.exe",
  "command-runner.exe",
  "codex-command-runner-x86_64-pc-windows-msvc.exe",
];

const SETUP_HELPER_NAMES = [
  "codex-windows-sandbox-setup.exe",
  "codex-windows-sandbox-setup-x86_64-pc-windows-msvc.exe",
];

export function resolveProviderWindowsSandboxMode(
  environment: NodeJS.ProcessEnv = process.env,
): WindowsSandboxMode {
  return resolveCommercialEngineWindowsSandboxMode(
    environment,
  ) satisfies CommercialEngineWindowsSandboxMode;
}

function hasAnyHelper(engineDir: string | undefined, names: ReadonlyArray<string>): boolean {
  if (!engineDir) {
    return false;
  }
  return names.some((name) => existsSync(path.join(engineDir, name)));
}

export function resolveEngineHelperDirectory(input: {
  readonly binaryPath: string;
  readonly environment?: NodeJS.ProcessEnv;
}): string | undefined {
  const bundledConfig = resolveBundledEngineConfig(input.environment ?? process.env);
  const effectiveBinaryPath = bundledConfig?.binaryPath ?? input.binaryPath;
  if (!effectiveBinaryPath.includes("/") && !effectiveBinaryPath.includes("\\")) {
    return undefined;
  }
  return path.dirname(effectiveBinaryPath);
}

export function readWindowsSandboxHelperAvailability(input: {
  readonly binaryPath: string;
  readonly environment?: NodeJS.ProcessEnv;
}): Pick<ServerProviderWindowsSandbox, "commandRunnerAvailable" | "setupHelperAvailable"> {
  const engineDir = resolveEngineHelperDirectory(input);
  return {
    commandRunnerAvailable: hasAnyHelper(engineDir, COMMAND_RUNNER_NAMES),
    setupHelperAvailable: hasAnyHelper(engineDir, SETUP_HELPER_NAMES),
  };
}

export function mapWindowsSandboxReadinessStatus(
  status: "ready" | "notConfigured" | "updateRequired" | undefined,
  lastError: string | null,
): WindowsSandboxReadinessStatus {
  if (lastError) {
    return "error";
  }
  return status ?? "error";
}

export function buildWindowsSandboxSnapshot(input: {
  readonly binaryPath: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly mode?: WindowsSandboxMode;
  readonly readiness?: "ready" | "notConfigured" | "updateRequired";
  readonly lastError?: string | null;
  readonly updatedAt: string;
}): ServerProviderWindowsSandbox {
  const lastError = input.lastError ?? null;
  return {
    mode: input.mode ?? resolveProviderWindowsSandboxMode(input.environment),
    readiness: mapWindowsSandboxReadinessStatus(input.readiness, lastError),
    ...readWindowsSandboxHelperAvailability({
      binaryPath: input.binaryPath,
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
    }),
    lastError,
    updatedAt: input.updatedAt,
  };
}
