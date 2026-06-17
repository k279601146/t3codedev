import type { ServerProviderWindowsSandbox } from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
export {
  isWindowsSandboxFirewallPolicyError,
  shouldOfferWindowsSandboxFirewallRepair,
} from "./windowsSandboxRepair.logic";

export async function repairWindowsSandboxFirewallWithConfirmation(): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (!bridge?.repairWindowsSandboxFirewall) {
    return false;
  }

  const confirmed = await ensureLocalApi().dialogs.confirm(
    "Windows elevated 沙箱需要 Windows 防火墙服务来隔离网络。是否以管理员权限尝试启动相关服务并重试？",
  );
  if (!confirmed) {
    return false;
  }

  const result = await bridge.repairWindowsSandboxFirewall();
  toastManager.add(
    stackedThreadToast({
      type: result.success ? "success" : "error",
      title: result.success ? "Windows 防火墙服务已就绪" : "无法修复 Windows 防火墙服务",
      description: result.message,
    }),
  );
  return result.success;
}
