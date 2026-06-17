const FRONTMATTER_BOUNDARY = /^---\s*$/;
const INLINE_METADATA_START_PATTERN = /^name\s*:\s*\S+/i;
const INLINE_METADATA_DESCRIPTION_PATTERN = /\bdescription\s*:/i;
const INLINE_METADATA_NEXT_FIELD_PATTERN =
  /\s(?:homepage|metadata|requires|security|iconSmall|iconLarge|displayName|shortDescription)\s*:/i;
const MARKDOWN_HEADING_PATTERN = /^#{1,4}\s+\S+/m;

export function normalizeSkillDetailMarkdown(markdown: string): string {
  const trimmed = stripYamlFrontmatter(markdown).trim();
  if (!INLINE_METADATA_START_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const headingMatch = MARKDOWN_HEADING_PATTERN.exec(trimmed);
  if (headingMatch?.index) {
    return trimmed.slice(headingMatch.index).trim();
  }

  const blocks = trimmed.split(/\n\s*\n/);
  const [firstBlock, ...restBlocks] = blocks;
  if (!firstBlock || !INLINE_METADATA_DESCRIPTION_PATTERN.test(firstBlock)) {
    return trimmed;
  }

  const rest = restBlocks.join("\n\n").trim();
  if (rest.length > 0) {
    return rest;
  }

  return extractInlineMetadataDescription(firstBlock) ?? trimmed;
}

function stripYamlFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (!FRONTMATTER_BOUNDARY.test(lines[0] ?? "")) {
    return markdown;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && FRONTMATTER_BOUNDARY.test(line));
  if (endIndex < 0) {
    return markdown;
  }

  return lines.slice(endIndex + 1).join("\n");
}

function extractInlineMetadataDescription(value: string): string | null {
  const descriptionStart = value.search(INLINE_METADATA_DESCRIPTION_PATTERN);
  if (descriptionStart < 0) {
    return null;
  }

  const afterLabel = value.slice(descriptionStart).replace(/^description\s*:\s*/i, "").trim();
  const nextField = INLINE_METADATA_NEXT_FIELD_PATTERN.exec(afterLabel);
  const description = (nextField?.index ? afterLabel.slice(0, nextField.index) : afterLabel)
    .replace(/^\|\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return description.length > 0 ? description : null;
}
