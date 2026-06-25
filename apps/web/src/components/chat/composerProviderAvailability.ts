import type { ServerProvider } from "@t3tools/contracts";

import {
  getFriendlyProviderStatusMessage,
  getServerProviderLabel,
  isProviderBackgroundPreparationMessage,
} from "../../providerStatusCopy";
import type { ModelEsque } from "./providerIconUtils";

export type ComposerProviderAvailabilityKind =
  | "ready"
  | "preparing"
  | "unavailable"
  | "noModels";

export interface ComposerProviderAvailability {
  readonly kind: ComposerProviderAvailabilityKind;
  readonly canSend: boolean;
  readonly triggerLabel: string | null;
  readonly menuEmptyMessage: string;
  readonly sendBlockMessage: string | null;
}

export function deriveComposerProviderAvailability(input: {
  readonly provider: ServerProvider | null;
  readonly modelOptions: ReadonlyArray<ModelEsque>;
  readonly selectedModel: string | null | undefined;
}): ComposerProviderAvailability {
  const { provider, modelOptions, selectedModel } = input;
  if (!provider) {
    return {
      kind: "unavailable",
      canSend: false,
      triggerLabel: "模型服务不可用",
      menuEmptyMessage: "模型服务状态未知",
      sendBlockMessage: "模型服务状态未知，请稍后重试。",
    };
  }

  const label = getServerProviderLabel(provider);
  if (!provider.enabled || provider.status === "disabled") {
    return {
      kind: "unavailable",
      canSend: false,
      triggerLabel: `${label} 已禁用`,
      menuEmptyMessage: `${label} 已在设置中禁用`,
      sendBlockMessage: `${label} 已在设置中禁用，请启用后再发送。`,
    };
  }

  if (provider.status !== "ready") {
    const isPreparing = isProviderBackgroundPreparationMessage(provider.message);
    const friendlyMessage = getFriendlyProviderStatusMessage(provider);
    if (isPreparing) {
      return {
        kind: "preparing",
        canSend: false,
        triggerLabel: `${label} 准备中`,
        menuEmptyMessage: `${label} 正在准备模型服务`,
        sendBlockMessage: `${label} 正在准备模型服务，请稍后再发送。`,
      };
    }
    return {
      kind: "unavailable",
      canSend: false,
      triggerLabel: `${label} 暂不可用`,
      menuEmptyMessage: friendlyMessage ?? `${label} 暂不可用`,
      sendBlockMessage: friendlyMessage ?? `${label} 暂不可用，请检查设置后重试。`,
    };
  }

  if (modelOptions.length === 0 || !selectedModel?.trim()) {
    return {
      kind: "noModels",
      canSend: false,
      triggerLabel: "没有可用模型",
      menuEmptyMessage: "没有可用模型",
      sendBlockMessage: "当前模型服务没有可用模型，请在设置中添加模型或等待服务刷新。",
    };
  }

  return {
    kind: "ready",
    canSend: true,
    triggerLabel: null,
    menuEmptyMessage: "没有可用模型",
    sendBlockMessage: null,
  };
}
