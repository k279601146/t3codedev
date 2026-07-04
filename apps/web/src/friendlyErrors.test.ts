import { describe, expect, it } from "vitest";

import { resolveFriendlyErrorMessage, sanitizeProviderErrorMessage } from "./friendlyErrors";

describe("friendlyErrors", () => {
  it("maps insufficient balance provider responses to actionable copy", () => {
    const friendly = resolveFriendlyErrorMessage(
      'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    );

    expect(friendly.title).toBe("账户余额不足");
    expect(friendly.description).toBe("账户余额不足，请充值或等待额度刷新后继续使用。");
    expect(friendly.description).not.toContain("unexpected status");
    expect(friendly.primaryActionLabel).toBe("充值");
  });

  it("maps legacy billing_error balance responses to insufficient balance copy", () => {
    const friendly = resolveFriendlyErrorMessage(
      'unexpected status 403 Forbidden: {"code":"billing_error","message":"insufficient balance"}',
    );

    expect(friendly.variant).toBe("warning");
    expect(friendly.title.length).toBeGreaterThan(0);
    expect(friendly.description).not.toContain("billing_error");
    expect(friendly.description).not.toContain("unexpected status");
  });

  it("normalizes gateway provider errors for thread surfaces", () => {
    const cases = [
      {
        raw: "unexpected status 404 Not Found: model is not found, url: https://sub.bahew.com/v1/responses, cf-ray: a13956896e4a115c-ORD, request id: 10c59330-90a7-44e4-ae39-6c351ac8a5a5",
        expected:
          "模型不存在或暂不可用。请求 ID：10c59330-90a7-44e4-ae39-6c351ac8a5a5",
      },
      {
        raw: "unexpected status 503 Service Unavailable: Service temporarily unavailable, url: https://sub.bahew.com/v1/responses, cf-ray: a13955484ca3ee11-ORD, request id: 43a06c06-65fb-41b3-842f-bbfca9053c38",
        expected:
          "服务暂时不可用，请稍后重试。请求 ID：43a06c06-65fb-41b3-842f-bbfca9053c38",
      },
      {
        raw: "unexpected status 403 Forbidden: 中国地区内容安全网关配置不可用，请联系管理员, url: https://sub.bahew.com/v1/responses, cf-ray: a13a2186dcf472e5-ORD, request id: 913e8326-abdd-4b8a-b64c-52b3a95da266",
        expected:
          "中国地区内容安全网关配置不可用，请联系管理员。请求 ID：913e8326-abdd-4b8a-b64c-52b3a95da266",
      },
      {
        raw: "unexpected status 403 Forbidden: insufficient balance, url: https://sub.bahew.com/v1/responses, cf-ray: a139e8ad79d41060-ORD, request id: 0720b576-b83d-4fa7-8c5b-ba882537a4ba",
        expected:
          "账户余额不足，请充值或等待额度刷新后继续使用。请求 ID：0720b576-b83d-4fa7-8c5b-ba882537a4ba",
      },
      {
        raw: 'unexpected status 401 Unauthorized: {"code":"USER_INACTIVE","message":"User account is not active"}, url: https://sub.bahew.com/v1/responses, cf-ray: a13a22d1eec6381e-ORD, request id: 329fc1b9-cd22-49a4-b474-f0d33aae577f',
        expected:
          "账号未激活，请完成账号激活后重试。请求 ID：329fc1b9-cd22-49a4-b474-f0d33aae577f",
      },
    ] as const;

    for (const entry of cases) {
      const normalized = sanitizeProviderErrorMessage(entry.raw);
      expect(normalized).toBe(entry.expected);
      expect(normalized).not.toContain("unexpected status");
      expect(normalized).not.toContain("url:");
      expect(normalized).not.toContain("cf-ray");
      expect(normalized).not.toContain("{");
      expect(normalized).not.toContain("USER_INACTIVE");
    }
  });

  it("trims empty provider errors before storing them", () => {
    expect(sanitizeProviderErrorMessage("  Failed  ")).toBe("Failed");
    expect(sanitizeProviderErrorMessage("   ")).toBeNull();
  });

  it("maps gateway html errors to readable thread copy", () => {
    const friendly = resolveFriendlyErrorMessage(`<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>nginx</center>
</body>
</html>`);

    expect(friendly.title).toBe("请求未能完成");
    expect(friendly.description).toBe("服务网关返回了异常响应，请稍后重试。");
    expect(friendly.description).not.toContain("<html>");
    expect(friendly.description).not.toContain("nginx");
  });
});
