import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveComposerProviderAvailability } from "./composerProviderAvailability";

function makeProvider(input: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "MyService",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-25T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...input,
  };
}

describe("deriveComposerProviderAvailability", () => {
  it("treats an unchecked provider as preparing and blocks send", () => {
    const availability = deriveComposerProviderAvailability({
      provider: makeProvider({
        status: "warning",
        message: "Codex provider status has not been checked in this session yet.",
      }),
      modelOptions: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      selectedModel: "gpt-5.4",
    });

    expect(availability.kind).toBe("preparing");
    expect(availability.canSend).toBe(false);
    expect(availability.triggerLabel).toBe("MyService 准备中");
  });

  it("surfaces provider errors and blocks send", () => {
    const availability = deriveComposerProviderAvailability({
      provider: makeProvider({
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Bahew is not signed in. Sign in to your account and try again.",
      }),
      modelOptions: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      selectedModel: "gpt-5.4",
    });

    expect(availability.kind).toBe("unavailable");
    expect(availability.canSend).toBe(false);
    expect(availability.menuEmptyMessage).toBe("尚未登录 Bahew 账号，请登录后重试。");
    expect(availability.sendBlockMessage).toBe("尚未登录 Bahew 账号，请登录后重试。");
  });

  it("blocks a ready provider with no selectable models", () => {
    const availability = deriveComposerProviderAvailability({
      provider: makeProvider(),
      modelOptions: [],
      selectedModel: "gpt-5.4",
    });

    expect(availability.kind).toBe("noModels");
    expect(availability.canSend).toBe(false);
    expect(availability.triggerLabel).toBe("没有可用模型");
  });

  it("allows send when the provider is ready and the selected model exists", () => {
    const availability = deriveComposerProviderAvailability({
      provider: makeProvider(),
      modelOptions: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      selectedModel: "gpt-5.4",
    });

    expect(availability).toEqual({
      kind: "ready",
      canSend: true,
      triggerLabel: null,
      menuEmptyMessage: "没有可用模型",
      sendBlockMessage: null,
    });
  });
});
