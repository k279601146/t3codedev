import type { ServerProvider } from "@t3tools/contracts";

import {
  getFriendlyProviderStatusMessage,
  getServerProviderLabel,
  isProviderBackgroundPreparationMessage,
} from "../../providerStatusCopy";
import type { WsConnectionUiState } from "../../rpc/wsConnectionState";
import type { ModelEsque } from "./providerIconUtils";

export type ComposerProviderAvailabilityKind =
  | "ready"
  | "preparing"
  | "unavailable"
  | "noModels"
  | "reconnecting";

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
  readonly backendConnectionState?: WsConnectionUiState;
  readonly isRefreshingModels?: boolean;
}): ComposerProviderAvailability {
  const {
    provider,
    modelOptions,
    selectedModel,
    backendConnectionState = "connected",
    isRefreshingModels = false,
  } = input;
  if (backendConnectionState !== "connected") {
    if (backendConnectionState === "offline") {
      return {
        kind: "reconnecting",
        canSend: false,
        triggerLabel: "后端离线",
        menuEmptyMessage: "当前网络离线，恢复网络后客户端会自动重连后端服务。",
        sendBlockMessage: "当前网络离线，恢复网络后客户端会自动重连后端服务。",
      };
    }
    if (backendConnectionState === "error") {
      return {
        kind: "unavailable",
        canSend: false,
        triggerLabel: "后端连接失败",
        menuEmptyMessage: "无法连接后端服务，客户端会自动重连；如果一直失败，请重启本地服务。",
        sendBlockMessage: "无法连接后端服务，客户端正在尝试重连，请稍后再发送。",
      };
    }
    if (backendConnectionState === "reconnecting") {
      return {
        kind: "reconnecting",
        canSend: false,
        triggerLabel: "后端重连中",
        menuEmptyMessage: "后端服务连接已断开，客户端正在自动重连。",
        sendBlockMessage: "后端服务正在重连，请稍后再发送。",
      };
    }
    return {
      kind: "reconnecting",
      canSend: false,
      triggerLabel: "连接后端中",
      menuEmptyMessage: "正在连接后端服务，连接成功后会自动刷新模型服务状态。",
      sendBlockMessage: "正在连接后端服务，请稍后再发送。",
    };
  }

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
      kind: isRefreshingModels ? "preparing" : "noModels",
      canSend: false,
      triggerLabel: isRefreshingModels ? "检查模型服务" : "模型服务无模型",
      menuEmptyMessage: isRefreshingModels
        ? `${label} 正在刷新模型服务状态。`
        : `${label} 已连接，但后端暂未返回可用模型；客户端会自动重试刷新模型服务。`,
      sendBlockMessage: isRefreshingModels
        ? `${label} 正在刷新模型服务状态，请稍后再发送。`
        : `${label} 暂未返回可用模型，客户端正在尝试刷新模型服务。`,
    };
  }

  return {
    kind: "ready",
    canSend: true,
    triggerLabel: null,
    menuEmptyMessage: "没有匹配的模型",
    sendBlockMessage: null,
  };
}
