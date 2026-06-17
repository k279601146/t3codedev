import type { ServerProviderWindowsSandbox } from "@t3tools/contracts";

const FIREWALL_REPAIR_ERROR_PATTERNS = [
  "helper_firewall_policy_access_failed",
  "INetFwPolicy2::LocalPolicyModifyState",
  "HRESULT(0x800706D9)",
  "0x800706D9",
] as const;

export function isWindowsSandboxFirewallPolicyError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return FIREWALL_REPAIR_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function shouldOfferWindowsSandboxFirewallRepair(
  sandbox: ServerProviderWindowsSandbox | null | undefined,
): boolean {
  if (!sandbox) {
    return false;
  }
  if (isWindowsSandboxFirewallPolicyError(sandbox.lastError)) {
    return true;
  }
  return sandbox.mode === "elevated" && sandbox.readiness === "updateRequired";
}
