import { assert, describe, it } from "@effect/vitest";

import { parseSkillDocument } from "./frontmatter.ts";

describe("parseSkillDocument", () => {
  it("解析 iconUrl 并保留正文", () => {
    const parsed = parseSkillDocument(`---
name: demo-skill
iconUrl: ./assets/icon.png
iconSmall: ./assets/small.png
iconLarge: ./assets/large.png
---
# Demo
`);

    assert.deepEqual(parsed.frontmatter, {
      name: "demo-skill",
      iconUrl: "./assets/icon.png",
      iconSmall: "./assets/small.png",
      iconLarge: "./assets/large.png",
    });
    assert.equal(parsed.body, "# Demo\n");
  });
});
