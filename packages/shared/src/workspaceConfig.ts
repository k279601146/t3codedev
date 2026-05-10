export interface MyIdeWorkspaceConfig {
  readonly project: {
    readonly name?: string;
    readonly defaultModel?: string;
  };
  readonly context: {
    readonly alwaysInclude: readonly string[];
    readonly ignore: readonly string[];
  };
  readonly rules: {
    readonly customInstructions?: string;
  };
}

type SectionName = "project" | "context" | "rules";

const EMPTY_CONFIG: MyIdeWorkspaceConfig = {
  project: {},
  context: {
    alwaysInclude: [],
    ignore: [],
  },
  rules: {},
};

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function stripComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return line.slice(0, index).trim();
    }
  }
  return line.trim();
}

function unescapeTomlBasicString(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function parseTomlString(rawValue: string): string | undefined {
  const value = rawValue.trim();
  if (value.startsWith('"""') && value.endsWith('"""') && value.length >= 6) {
    return value.slice(3, -3).trim();
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return unescapeTomlBasicString(value.slice(1, -1)).trim();
  }
  return cleanString(value);
}

function parseTomlStringArray(rawValue: string): readonly string[] {
  const values: string[] = [];
  const matcher = /"((?:\\.|[^"\\])*)"/g;
  for (const match of rawValue.matchAll(matcher)) {
    values.push(unescapeTomlBasicString(match[1] ?? ""));
  }
  return uniqueNonEmpty(values);
}

function assignConfigValue(
  config: {
    project: { name?: string; defaultModel?: string };
    context: { alwaysInclude: string[]; ignore: string[] };
    rules: { customInstructions?: string };
  },
  section: SectionName,
  key: string,
  rawValue: string,
) {
  if (section === "project") {
    if (key === "name") {
      const name = cleanString(parseTomlString(rawValue));
      if (name !== undefined) {
        config.project.name = name;
      }
    } else if (key === "default_model") {
      const defaultModel = cleanString(parseTomlString(rawValue));
      if (defaultModel !== undefined) {
        config.project.defaultModel = defaultModel;
      }
    }
    return;
  }

  if (section === "context") {
    if (key === "always_include") {
      config.context.alwaysInclude = [...parseTomlStringArray(rawValue)];
    } else if (key === "ignore") {
      config.context.ignore = [...parseTomlStringArray(rawValue)];
    }
    return;
  }

  if (key === "custom_instructions") {
    const customInstructions = cleanString(parseTomlString(rawValue));
    if (customInstructions !== undefined) {
      config.rules.customInstructions = customInstructions;
    }
  }
}

export function parseMyIdeWorkspaceConfigToml(rawToml: string): MyIdeWorkspaceConfig {
  let section: SectionName | undefined;
  let pending:
    | {
        readonly section: SectionName;
        readonly key: string;
        readonly terminator: string;
        readonly lines: string[];
      }
    | undefined;
  const config = {
    project: { ...EMPTY_CONFIG.project },
    context: {
      alwaysInclude: [...EMPTY_CONFIG.context.alwaysInclude],
      ignore: [...EMPTY_CONFIG.context.ignore],
    },
    rules: { ...EMPTY_CONFIG.rules },
  };

  const flushPending = () => {
    if (!pending) return;
    assignConfigValue(config, pending.section, pending.key, pending.lines.join("\n"));
    pending = undefined;
  };

  for (const rawLine of rawToml.split(/\r?\n/)) {
    const line = pending ? rawLine.trimEnd() : stripComment(rawLine);
    if (line.length === 0 && !pending) continue;

    if (pending) {
      pending.lines.push(line);
      if (line.includes(pending.terminator)) {
        flushPending();
      }
      continue;
    }

    const sectionMatch = /^\[([a-z_]+)\]$/.exec(line);
    if (sectionMatch) {
      const rawSection = sectionMatch[1];
      section =
        rawSection === "project" || rawSection === "context" || rawSection === "rules"
          ? rawSection
          : undefined;
      continue;
    }

    if (!section) continue;
    const assignment = /^([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;

    const key = assignment[1] ?? "";
    const rawValue = assignment[2] ?? "";
    if (rawValue.startsWith('"""') && !rawValue.slice(3).includes('"""')) {
      pending = { section, key, terminator: '"""', lines: [rawValue] };
      continue;
    }
    if (rawValue.startsWith("[") && !rawValue.includes("]")) {
      pending = { section, key, terminator: "]", lines: [rawValue] };
      continue;
    }

    assignConfigValue(config, section, key, rawValue);
  }

  flushPending();

  return {
    project: {
      ...(config.project.name ? { name: config.project.name } : {}),
      ...(config.project.defaultModel ? { defaultModel: config.project.defaultModel } : {}),
    },
    context: {
      alwaysInclude: uniqueNonEmpty(config.context.alwaysInclude),
      ignore: uniqueNonEmpty(config.context.ignore),
    },
    rules: {
      ...(config.rules.customInstructions
        ? { customInstructions: config.rules.customInstructions }
        : {}),
    },
  };
}
