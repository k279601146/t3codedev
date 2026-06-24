import { describe, expect, it } from "vitest";

import { getPatchDisplayPath, parseUnifiedDiff } from "./unifiedDiff";

describe("parseUnifiedDiff", () => {
  it("does not treat added content beginning with plus markers as a file path", () => {
    const diff = [
      "diff --git a/output/outline.md b/output/outline.md",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/output/outline.md",
      "@@ -0,0 +1,3 @@",
      "+# Title",
      "+++\u0020\u9686\u51ac\u814a\u6708\uff0c\u5927\u96ea\u7eb7\u98de",
      "+Body",
      "",
    ].join("\n");

    const patches = parseUnifiedDiff(diff);

    expect(patches).toHaveLength(1);
    expect(getPatchDisplayPath(patches[0]!)).toBe("output/outline.md");
    expect(patches[0]?.hunks[0]?.lines.filter((line) => line.type === "add")).toHaveLength(3);
  });
});
