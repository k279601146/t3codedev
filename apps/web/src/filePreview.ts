import { splitPathAndPosition } from "./terminal-links";

export const TEXT_PREVIEW_FILE_EXTENSIONS = [
  "adoc",
  "astro",
  "bat",
  "c",
  "cc",
  "cjs",
  "clj",
  "cljs",
  "cmd",
  "cpp",
  "cs",
  "css",
  "csv",
  "cts",
  "cxx",
  "dart",
  "diff",
  "dockerignore",
  "editorconfig",
  "env",
  "erl",
  "ex",
  "exs",
  "frag",
  "fs",
  "fsx",
  "gitignore",
  "glsl",
  "go",
  "gql",
  "graphql",
  "gradle",
  "h",
  "hpp",
  "hrl",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "json5",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lock",
  "log",
  "lua",
  "m",
  "markdown",
  "md",
  "mdx",
  "metal",
  "mjs",
  "mm",
  "mts",
  "npmrc",
  "patch",
  "php",
  "pnpmfile",
  "prettierrc",
  "prisma",
  "properties",
  "proto",
  "ps1",
  "py",
  "r",
  "rb",
  "rs",
  "rst",
  "sass",
  "scala",
  "scss",
  "sh",
  "sol",
  "sql",
  "svelte",
  "svg",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vb",
  "vert",
  "vue",
  "wgsl",
  "xml",
  "yaml",
  "yml",
  "zsh",
] as const;

export const KNOWN_EXTENSIONLESS_TEXT_FILENAMES = [
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
  "babelrc",
  "browserslistrc",
  "envrc",
  "eslintrc",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "node-version",
  "npmrc",
  "prettierrc",
  "tool-versions",
  "yarnrc",
] as const;

const KNOWN_EXTENSIONLESS_TEXT_FILENAME_SET = new Set<string>(KNOWN_EXTENSIONLESS_TEXT_FILENAMES);
const AUTO_LINK_TEXT_BASENAMES = ["dockerfile", "makefile"] as const;
const AUTO_LINK_TEXT_DOTFILENAMES = [
  "babelrc",
  "browserslistrc",
  "envrc",
  "eslintrc",
  "gitattributes",
  "gitignore",
  "node-version",
  "npmrc",
  "prettierrc",
  "tool-versions",
  "yarnrc",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const TEXT_PREVIEW_FILE_EXTENSION_PATTERN_SOURCE = [...TEXT_PREVIEW_FILE_EXTENSIONS]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join("|");

export const TEXT_PREVIEW_BASENAME_PATTERN_SOURCE = [
  ...AUTO_LINK_TEXT_BASENAMES,
  ...AUTO_LINK_TEXT_DOTFILENAMES.map((basename) => `.${basename}`),
]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join("|");

export function looksLikeDirectoryPreviewPath(filePath: string): boolean {
  const { path } = splitPathAndPosition(filePath);
  if (/[\\/]$/.test(path)) {
    return true;
  }

  const basename = path.split(/[\\/]/).filter(Boolean).at(-1);
  if (!basename) {
    return false;
  }
  if (basename.includes(".")) {
    return false;
  }
  return !KNOWN_EXTENSIONLESS_TEXT_FILENAME_SET.has(basename.toLowerCase());
}

export function isTextPreviewFilePath(filePath: string): boolean {
  const { path } = splitPathAndPosition(filePath);
  const basename = path.split(/[\\/]/).at(-1) ?? path;
  const extension = basename.includes(".") ? basename.split(".").at(-1)?.toLowerCase() : undefined;
  if (!extension) {
    return true;
  }
  return TEXT_PREVIEW_FILE_EXTENSIONS.includes(
    extension as (typeof TEXT_PREVIEW_FILE_EXTENSIONS)[number],
  );
}
