import { describe, expect, it } from "vitest";
import { truncateTextForPreview } from "./textPreview";

describe("truncateTextForPreview", () => {
  it("keeps short text intact", () => {
    expect(truncateTextForPreview({ text: "a\nb", maxChars: 10, maxLines: 4 })).toEqual({
      text: "a\nb",
      truncated: false,
    });
  });

  it("truncates by line and character limits without changing the source text", () => {
    const source = ["12345", "67890", "abcdef", "tail"].join("\n");
    const preview = truncateTextForPreview({ text: source, maxChars: 12, maxLines: 3 });

    expect(preview).toEqual({
      text: "12345\n67890",
      truncated: true,
    });
    expect(source).toContain("tail");
  });
});
