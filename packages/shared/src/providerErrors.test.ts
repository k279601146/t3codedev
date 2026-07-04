import { describe, expect, it } from "vitest";

import {
  normalizeProviderErrorMessage,
  sanitizeProviderErrorMessage,
  selectPreferredProviderErrorMessage,
  shouldPreferProviderErrorContext,
} from "./providerErrors.ts";

describe("providerErrors", () => {
  it("maps insufficient balance provider responses to actionable Chinese copy", () => {
    const normalized = normalizeProviderErrorMessage(
      'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    );

    expect(normalized?.kind).toBe("insufficient_balance");
    expect(normalized?.message).toBe("账户余额不足，请充值或等待额度刷新后继续使用。");
    expect(normalized?.isActionable).toBe(true);
  });

  it("normalizes gateway provider errors and preserves request id", () => {
    const normalized = sanitizeProviderErrorMessage(
      "unexpected status 404 Not Found: model is not found, url: https://sub.bahew.com/v1/responses, cf-ray: a13956896e4a115c-ORD, request id: 10c59330-90a7-44e4-ae39-6c351ac8a5a5",
    );

    expect(normalized).toBe(
      "模型不存在或暂不可用。请求 ID：10c59330-90a7-44e4-ae39-6c351ac8a5a5",
    );
  });

  it("does not expose nginx html errors to users", () => {
    const normalized = normalizeProviderErrorMessage(`<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>nginx</center>
</body>
</html>`);

    expect(normalized?.kind).toBe("gateway_bad_response");
    expect(normalized?.message).toBe("服务网关返回了异常响应，请稍后重试。");
    expect(normalized?.message).not.toContain("<html>");
    expect(normalized?.message).not.toContain("nginx");
  });

  it("uses nested additional details when provider wrapper message is generic", () => {
    const normalized = normalizeProviderErrorMessage("Reconnecting... 1/5", {
      error: {
        additionalDetails:
          "unexpected status 403 Forbidden: 账户余额不足，请充值后重试, url: https://sub.bahew.com/v1/responses, request id: 46b10970-db7e-4d8d-885d-a4f5d36e46ec",
      },
    });

    expect(normalized?.kind).toBe("insufficient_balance");
    expect(normalized?.message).toBe(
      "账户余额不足，请充值或等待额度刷新后继续使用。请求 ID：46b10970-db7e-4d8d-885d-a4f5d36e46ec",
    );
  });

  it("keeps request id from details when wrapper message is already normalized", () => {
    const normalized = normalizeProviderErrorMessage(
      "账户余额不足，请充值或等待额度刷新后继续使用。",
      {
        error: {
          additionalDetails:
            "unexpected status 403 Forbidden: 账户余额不足，请充值后重试, url: https://sub.bahew.com/v1/responses, request id: 46b10970-db7e-4d8d-885d-a4f5d36e46ec",
        },
      },
    );

    expect(normalized?.kind).toBe("insufficient_balance");
    expect(normalized?.message).toBe(
      "账户余额不足，请充值或等待额度刷新后继续使用。请求 ID：46b10970-db7e-4d8d-885d-a4f5d36e46ec",
    );
  });

  it("prefers actionable prior context over final gateway html noise", () => {
    const current = normalizeProviderErrorMessage("<html><h1>400 Bad Request</h1></html>");
    const previous = normalizeProviderErrorMessage("账户余额不足，请充值或等待额度刷新后继续使用。");

    expect(shouldPreferProviderErrorContext(current, previous)).toBe(true);
  });

  it("selects actionable context over final gateway html message", () => {
    const selected = selectPreferredProviderErrorMessage(
      "<html><h1>400 Bad Request</h1><hr><center>nginx</center></html>",
      undefined,
      [
        {
          message: "账户余额不足，请充值或等待额度刷新后继续使用。",
          detail: {
            error: {
              additionalDetails:
                "unexpected status 403 Forbidden: 账户余额不足，请充值后重试, request id: 46b10970-db7e-4d8d-885d-a4f5d36e46ec",
            },
          },
        },
      ],
    );

    expect(selected).toBe(
      "账户余额不足，请充值或等待额度刷新后继续使用。请求 ID：46b10970-db7e-4d8d-885d-a4f5d36e46ec",
    );
  });
});
