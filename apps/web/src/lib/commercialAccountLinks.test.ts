import { describe, expect, it } from "vitest";

import { resolveCommercialAccountActionUrl } from "./commercialAccountLinks";

describe("商业账号链接", () => {
  it("使用配置的账号站点生成操作链接", () => {
    expect(resolveCommercialAccountActionUrl("https://accounts.example.com/app", "/pricing")).toBe(
      "https://accounts.example.com/pricing",
    );
  });

  it("账号站点配置无效时回退到默认站点", () => {
    expect(resolveCommercialAccountActionUrl(":", "/account/billing")).toBe(
      "https://www.bahew.com/account/billing",
    );
  });
});
