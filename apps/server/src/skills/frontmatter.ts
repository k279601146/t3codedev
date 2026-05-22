/**
 * SKILL.md frontmatter 解析。
 *
 * 我们只关心几个固定字段（name / description / shortDescription / iconSmall / iconLarge），
 * 不引入完整 YAML 解析依赖；手写一个最小子集解析器就够了，因为 OpenAI curated 仓库
 * 中的 frontmatter 都是简单的 key: "value" 形式。
 */

export interface ParsedSkillFrontmatter {
  readonly name?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly shortDescription?: string;
  readonly iconSmall?: string;
  readonly iconLarge?: string;
}

export interface ParsedSkillDocument {
  readonly frontmatter: ParsedSkillFrontmatter;
  /** 去掉 frontmatter 之后的 markdown 正文 */
  readonly body: string;
}

const FRONTMATTER_BOUNDARY = /^---\s*$/;

export function parseSkillDocument(raw: string): ParsedSkillDocument {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_BOUNDARY.test(lines[0] ?? "")) {
    return { frontmatter: {}, body: raw };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_BOUNDARY.test(lines[i] ?? "")) {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n");
  const frontmatter = parseFrontmatterLines(frontmatterLines);
  return { frontmatter, body };
}

function parseFrontmatterLines(lines: ReadonlyArray<string>): ParsedSkillFrontmatter {
  const out: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentBuffer: Array<string> = [];
  let blockIndent = 0;

  const flush = () => {
    if (currentKey === null) return;
    const joined = currentBuffer
      .map((line) => line.slice(Math.min(blockIndent, line.length)))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (joined.length > 0) {
      out[currentKey] = joined;
    }
    currentKey = null;
    currentBuffer = [];
    blockIndent = 0;
  };

  for (const line of lines) {
    if (line.trim().length === 0) {
      // 空行：保留以分隔块标量
      if (currentKey !== null) {
        currentBuffer.push("");
      }
      continue;
    }

    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (keyMatch && line === line.trimStart()) {
      // 顶层 key
      flush();
      const [, key, rest] = keyMatch;
      const trimmed = rest!.trim();
      if (trimmed === ">" || trimmed === ">-" || trimmed === "|" || trimmed === "|-") {
        currentKey = key!;
        currentBuffer = [];
        blockIndent = 0;
        continue;
      }
      if (trimmed.length === 0) {
        // 没值的 key 暂时跳过
        continue;
      }
      out[key!] = stripQuotes(trimmed);
      continue;
    }

    // 续行：加进当前块标量
    if (currentKey !== null) {
      if (blockIndent === 0) {
        const leading = line.match(/^\s*/)?.[0] ?? "";
        blockIndent = leading.length;
      }
      currentBuffer.push(line);
    }
  }

  flush();

  return {
    name: out["name"] ?? undefined,
    displayName: out["displayName"] ?? undefined,
    description: out["description"] ?? undefined,
    shortDescription: out["shortDescription"] ?? undefined,
    iconSmall: out["iconSmall"] ?? undefined,
    iconLarge: out["iconLarge"] ?? undefined,
  };
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
