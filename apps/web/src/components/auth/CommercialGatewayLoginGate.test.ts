import { describe, expect, it } from "vitest";

import {
  formatCommercialAuthErrorMessage,
  type CommercialAuthErrorMessages,
} from "./CommercialGatewayLoginGate";

const messages: CommercialAuthErrorMessages = {
  failed: "登录失败，请稍后重试。",
  timedOut: "登录已超时。请重新点击登录，并在浏览器里完成授权。",
  cancelled: "已取消登录。",
  browserOpenFailed: "无法打开浏览器。",
  authorizationFailed: "浏览器授权没有完成。",
  tokenExchangeFailed: "账号连接失败。",
  secureStorageUnavailable: "当前设备无法安全保存登录状态。",
};

describe("formatCommercialAuthErrorMessage", () => {
  it("maps Electron IPC browser timeout errors to a user-facing message", () => {
    const error = new Error(
      "Error invoking remote method 'desktop:sign-in-commercial-auth-with-browser': DesktopCommercialAuthPKCEError: Timed out waiting for browser sign-in.",
    );

    expect(formatCommercialAuthErrorMessage(error, messages)).toBe(messages.timedOut);
  });

  it("keeps non-technical gateway messages after removing desktop wrappers", () => {
    const error =
      "Error invoking remote method 'desktop:sign-in-commercial-auth-with-browser': DesktopCommercialAuthExchangeError: 当前账号未开通 IDE 访问权限。";

    expect(formatCommercialAuthErrorMessage(error, messages)).toBe("当前账号未开通 IDE 访问权限。");
  });

  it("falls back instead of exposing technical transport details", () => {
    const error = new Error(
      "Error invoking remote method 'desktop:sign-in-commercial-auth-with-browser': DesktopCommercialAuthPKCEError: ECONNREFUSED 127.0.0.1:443",
    );

    expect(formatCommercialAuthErrorMessage(error, messages)).toBe(messages.failed);
  });
});
