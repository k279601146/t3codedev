import type {
  ProviderInstanceId,
  ProviderWindowsSandboxSetupStartResult,
  ServerProviderWindowsSandbox,
} from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import {
  repairWindowsSandboxFirewallWithConfirmation,
  shouldOfferWindowsSandboxFirewallRepair,
} from "./windowsSandboxRepair";

export interface WindowsSandboxSetupFlowOptions {
  readonly providerInstanceId: ProviderInstanceId;
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly onChecked?: (sandbox: ServerProviderWindowsSandbox) => void;
}

export interface WindowsSandboxSetupFlowResult {
  readonly result: ProviderWindowsSandboxSetupStartResult;
  readonly repairedFirewall: boolean;
}

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 1_500;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function waitForWindowsSandboxSettled(
  input: Required<
    Pick<WindowsSandboxSetupFlowOptions, "providerInstanceId" | "attempts" | "delayMs">
  > & { readonly onChecked?: (sandbox: ServerProviderWindowsSandbox) => void },
): Promise<ServerProviderWindowsSandbox> {
  const api = ensureLocalApi();
  let latest: ServerProviderWindowsSandbox | null = null;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(input.delayMs);
    }
    const result = await api.server.windowsSandboxReadiness({
      providerInstanceId: input.providerInstanceId,
      mode: "elevated",
    });
    latest = result.windowsSandbox;
    input.onChecked?.(latest);
    if (latest.readiness === "error" || shouldOfferWindowsSandboxFirewallRepair(latest)) {
      return latest;
    }
  }
  if (!latest) {
    throw new Error("未收到 Windows 沙箱 readiness。");
  }
  return latest;
}

export async function runElevatedWindowsSandboxSetupFlow(
  options: WindowsSandboxSetupFlowOptions,
): Promise<WindowsSandboxSetupFlowResult> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const api = ensureLocalApi();
  const startSetup = () =>
    api.server.windowsSandboxSetupStart({
      providerInstanceId: options.providerInstanceId,
      mode: "elevated",
    });
  const waitInput = () => ({
    providerInstanceId: options.providerInstanceId,
    attempts,
    delayMs,
    ...(options.onChecked ? { onChecked: options.onChecked } : {}),
  });

  let result = await startSetup();
  options.onChecked?.(result.windowsSandbox);

  const shouldWait = result.started;
  if (shouldWait) {
    const settled = await waitForWindowsSandboxSettled(waitInput());
    result = {
      ...result,
      windowsSandbox: settled,
    };
  }

  if (shouldOfferWindowsSandboxFirewallRepair(result.windowsSandbox)) {
    const repairedFirewall = await repairWindowsSandboxFirewallWithConfirmation();
    if (!repairedFirewall) {
      return { result, repairedFirewall: false };
    }

    result = await startSetup();
    options.onChecked?.(result.windowsSandbox);
    if (result.started) {
      const settled = await waitForWindowsSandboxSettled(waitInput());
      result = {
        ...result,
        windowsSandbox: settled,
      };
    }
    return { result, repairedFirewall: true };
  }

  return { result, repairedFirewall: false };
}
