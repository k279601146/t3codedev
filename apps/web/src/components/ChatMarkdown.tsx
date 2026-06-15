import { DiffsHighlighter, getSharedHighlighter, SupportedLanguages } from "@pierre/diffs";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import React, {
  Children,
  Suspense,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { renderSkillInlineMarkdownChildren } from "./chat/SkillInlineText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { openInPreferredEditor } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import {
  type MarkdownFileLinkMeta,
  normalizeMarkdownLinkDestination,
  resolveMarkdownFileLinkMeta,
  rewriteMarkdownFileUriHref,
} from "../markdown-links";
import { readLocalApi } from "../localApi";
import { cn } from "../lib/utils";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
}

const EMPTY_MARKDOWN_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

function extractFenceLanguageLabel(className: string | undefined): string | null {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  return match?.[1] ?? null;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

type ReactElementWithChildren = React.ReactElement<{ children?: ReactNode }>;

function isElementType(node: ReactNode, type: string): node is ReactElementWithChildren {
  return isValidElement<{ children?: ReactNode }>(node) && node.type === type;
}

function firstChildElementOfType(
  children: ReactNode,
  type: string,
): ReactElementWithChildren | null {
  for (const child of Children.toArray(children)) {
    if (isElementType(child, type)) return child;
  }
  return null;
}

function extractMarkdownTableHeaderLabels(children: ReactNode): string[] {
  const thead = firstChildElementOfType(children, "thead");
  const headerRow = thead
    ? firstChildElementOfType(thead.props.children, "tr")
    : firstChildElementOfType(children, "tr");
  if (!headerRow) return [];

  return Children.toArray(headerRow.props.children)
    .filter((child): child is ReactElementWithChildren => isElementType(child, "th"))
    .map((child) => nodeToPlainText(child.props.children).trim())
    .filter((label) => label.length > 0);
}

function enhanceMarkdownTableRowCells(
  children: ReactNode,
  headerLabels: ReadonlyArray<string>,
): ReactNode {
  let columnIndex = 0;
  return Children.map(children, (child) => {
    if (!isElementType(child, "td")) return child;

    const label = headerLabels[columnIndex] ?? `第 ${columnIndex + 1} 列`;
    columnIndex += 1;
    return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      "data-label": label,
    });
  });
}

function enhanceMarkdownTableChildren(
  children: ReactNode,
  headerLabels: ReadonlyArray<string>,
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return child;

    if (child.type === "tr") {
      return React.cloneElement(
        child,
        undefined,
        enhanceMarkdownTableRowCells(child.props.children, headerLabels),
      );
    }

    if (child.props.children === undefined) return child;
    return React.cloneElement(
      child,
      undefined,
      enhanceMarkdownTableChildren(child.props.children, headerLabels),
    );
  });
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw err;
    }
    // Language not supported by Shiki — fall back to "text"
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function MarkdownCodeBlock({
  code,
  languageLabel,
  children,
}: {
  code: string;
  languageLabel: string | null;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className={cn("chat-markdown-codeblock leading-snug", languageLabel && "has-language")}>
      {languageLabel ? (
        <div className="chat-markdown-codeblock-language">{languageLabel}</div>
      ) : null}
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
      isStreaming={isStreaming}
    />
  );
}

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
  isStreaming: boolean;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
  isStreaming,
}: UncachedShikiCodeBlockProps) {
  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

interface MarkdownFileLinkProps {
  href: string;
  targetPath: string;
  displayPath: string;
  filePath: string;
  label: string;
  theme: "light" | "dark";
  line?: number | undefined;
  column?: number | undefined;
  className?: string | undefined;
  onOpenFile?: ((file: MarkdownFileLinkMeta) => void) | undefined;
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const PLAIN_FILE_PATH_PATTERN =
  /(?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>)\]]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+){0,2}|[A-Za-z0-9._-]+\.(?:c|cc|cjs|cpp|cs|css|cts|cxx|env|gif|go|gql|graphql|h|hpp|htm|html|ini|java|jpeg|jpg|js|json|jsx|kt|kts|log|md|mdx|mjs|mts|pdf|php|png|ps1|py|rb|rs|sass|scss|sh|sql|svg|swift|toml|ts|tsx|txt|webp|xml|yaml|yml|zsh)(?::\d+){0,2}/gi;
const PLAIN_URL_PATTERN = /https?:\/\/[^\s"'`<>)\]]+/gi;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const PLAIN_LINE_SUFFIX_PATTERN = /^\s*\(line\s+(\d+)\)/i;
const MARKDOWN_PROTECTED_INLINE_PATTERN = /!?\[[^\]\n]*]\([^)\n]*\)/g;
const MARKDOWN_FILE_LINK_CLASS_NAME =
  "chat-markdown-file-link relative top-[2px] max-w-full no-underline";
const MARKDOWN_FILE_LINK_ICON_CLASS_NAME = "chat-markdown-file-link-icon size-3.5 shrink-0";
const MARKDOWN_FILE_LINK_LABEL_CLASS_NAME = "chat-markdown-file-link-label truncate";

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  return rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownLinkDestination(value: string): string {
  return value.replace(/>/g, "%3E").replace(/\)/g, "%29");
}

function trimPlainFilePathCandidate(value: string): string {
  let output = value.replace(/[.,;!?]+$/g, "");
  while (output.endsWith(")") || output.endsWith("]") || output.endsWith("}")) {
    const close = output.charAt(output.length - 1);
    const open = close === ")" ? "(" : close === "]" ? "[" : "{";
    const opens = output.split(open).length - 1;
    const closes = output.split(close).length - 1;
    if (opens >= closes) break;
    output = output.slice(0, -1);
  }
  return output;
}

function trimPlainUrlCandidate(value: string): string {
  let output = value.replace(/[.,;!?，。；！？]+$/g, "");
  while (output.endsWith(")") || output.endsWith("]") || output.endsWith("}")) {
    const close = output.charAt(output.length - 1);
    const open = close === ")" ? "(" : close === "]" ? "[" : "{";
    const opens = output.split(open).length - 1;
    const closes = output.split(close).length - 1;
    if (opens >= closes) break;
    output = output.slice(0, -1);
  }
  return output;
}

function protectedMarkdownRanges(segment: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  MARKDOWN_PROTECTED_INLINE_PATTERN.lastIndex = 0;
  for (const match of segment.matchAll(MARKDOWN_PROTECTED_INLINE_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function rangeContains(
  ranges: ReadonlyArray<{ start: number; end: number }>,
  start: number,
  end: number,
): boolean {
  return ranges.some((range) => start < range.end && range.start < end);
}

function markdownUrlLink(value: string): string {
  return `[${escapeMarkdownLinkLabel(value)}](${escapeMarkdownLinkDestination(value)})`;
}

function markdownFileLink(value: string): string {
  return `[${escapeMarkdownLinkLabel(value)}](<${escapeMarkdownLinkDestination(value)}>)`;
}

function addLineSuffixToTarget(
  target: string,
  textAfterMatch: string,
): {
  target: string;
  consumedSuffix: string;
} {
  if (/:\d+(?::\d+)?$/.test(target)) {
    return { target, consumedSuffix: "" };
  }
  const lineMatch = textAfterMatch.match(PLAIN_LINE_SUFFIX_PATTERN);
  const line = lineMatch?.[1];
  if (!line) {
    return { target, consumedSuffix: "" };
  }
  return { target: `${target}:${line}`, consumedSuffix: lineMatch[0] };
}

function linkifyInlineCodeTargetsInSegment(segment: string, cwd: string | undefined): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  INLINE_CODE_PATTERN.lastIndex = 0;

  for (const match of segment.matchAll(INLINE_CODE_PATTERN)) {
    const start = match.index ?? -1;
    const rawValue = match[1];
    if (start < 0 || !rawValue) continue;
    const trimmedValue = rawValue.trim();
    if (trimmedValue.length !== rawValue.length || /\s/.test(trimmedValue)) continue;

    const urlValue = trimPlainUrlCandidate(trimmedValue);
    if (/^https?:\/\//i.test(urlValue)) {
      replacements.push({
        start,
        end: start + match[0].length,
        value: markdownUrlLink(urlValue),
      });
      continue;
    }

    const fileValue = trimPlainFilePathCandidate(trimmedValue);
    if (resolveMarkdownFileLinkMeta(fileValue, cwd)) {
      replacements.push({
        start,
        end: start + match[0].length,
        value: markdownFileLink(fileValue),
      });
    }
  }

  if (replacements.length === 0) return segment;

  let output = "";
  let cursor = 0;
  for (const replacement of replacements) {
    output += segment.slice(cursor, replacement.start);
    output += replacement.value;
    cursor = replacement.end;
  }
  output += segment.slice(cursor);
  return output;
}

function linkifyPlainFilePathsInSegment(segment: string, cwd: string | undefined): string {
  const protectedRanges = protectedMarkdownRanges(segment);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  PLAIN_URL_PATTERN.lastIndex = 0;
  for (const match of segment.matchAll(PLAIN_URL_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const rawCandidate = match[0];
    const trimmedCandidate = trimPlainUrlCandidate(rawCandidate);
    if (trimmedCandidate.length === 0) continue;

    const candidateEnd = start + trimmedCandidate.length;
    if (rangeContains(protectedRanges, start, candidateEnd)) continue;
    replacements.push({
      start,
      end: candidateEnd,
      value: markdownUrlLink(trimmedCandidate),
    });
  }

  PLAIN_FILE_PATH_PATTERN.lastIndex = 0;

  for (const match of segment.matchAll(PLAIN_FILE_PATH_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const rawCandidate = match[0];
    const trimmedCandidate = trimPlainFilePathCandidate(rawCandidate);
    if (trimmedCandidate.length === 0) continue;

    const candidateEnd = start + trimmedCandidate.length;
    if (rangeContains(protectedRanges, start, candidateEnd)) continue;
    if (rangeContains(replacements, start, candidateEnd)) continue;

    const { target, consumedSuffix } = addLineSuffixToTarget(
      trimmedCandidate,
      segment.slice(candidateEnd),
    );
    if (!resolveMarkdownFileLinkMeta(target, cwd)) continue;

    replacements.push({
      start,
      end: candidateEnd + consumedSuffix.length,
      value: markdownFileLink(trimmedCandidate),
    });
  }

  if (replacements.length === 0) {
    return segment;
  }

  let output = "";
  let cursor = 0;
  for (const replacement of replacements.toSorted((a, b) => a.start - b.start)) {
    if (replacement.start < cursor) continue;
    output += segment.slice(cursor, replacement.start);
    output += replacement.value;
    cursor = replacement.end;
  }
  output += segment.slice(cursor);
  return output;
}

function linkifyPlainFilePaths(text: string, cwd: string | undefined): string {
  const lines = text.split(/(\r?\n)/);
  let inFence = false;
  let fenceMarker: "```" | "~~~" | null = null;
  return lines
    .map((part) => {
      if (part === "\n" || part === "\r\n") return part;
      const trimmed = part.trimStart();
      const startsBacktickFence = trimmed.startsWith("```");
      const startsTildeFence = trimmed.startsWith("~~~");
      const isFenceBoundary =
        (fenceMarker === "```" && startsBacktickFence) ||
        (fenceMarker === "~~~" && startsTildeFence) ||
        (!inFence && (startsBacktickFence || startsTildeFence));

      if (isFenceBoundary) {
        if (inFence) {
          inFence = false;
          fenceMarker = null;
        } else {
          inFence = true;
          fenceMarker = startsBacktickFence ? "```" : "~~~";
        }
        return part;
      }

      return inFence
        ? part
        : linkifyPlainFilePathsInSegment(linkifyInlineCodeTargetsInSegment(part, cwd), cwd);
    })
    .join("");
}

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  targetPath,
  displayPath,
  filePath,
  label,
  theme,
  line,
  column,
  className,
  onOpenFile,
}: MarkdownFileLinkProps) {
  const handleOpen = useCallback(() => {
    if (onOpenFile) {
      onOpenFile({
        filePath,
        targetPath,
        displayPath,
        basename: filePath.split(/[\\/]/).at(-1) ?? filePath,
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {}),
      });
      return;
    }

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    void openInPreferredEditor(api, targetPath).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, [column, displayPath, filePath, line, onOpenFile, targetPath]);

  const handleCopy = useCallback((value: string, title: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(value).then(
      () => {
        toastManager.add({
          type: "success",
          title: `${title} copied`,
          description: value,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, []);

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "open", label: "Open in editor" },
          { id: "copy-relative", label: "Copy relative path" },
          { id: "copy-full", label: "Copy full path" },
        ] as const,
        { x: event.clientX, y: event.clientY },
      );

      if (clicked === "open") {
        handleOpen();
        return;
      }
      if (clicked === "copy-relative") {
        handleCopy(displayPath, "Relative path");
        return;
      }
      if (clicked === "copy-full") {
        handleCopy(targetPath, "Full path");
      }
    },
    [displayPath, handleCopy, handleOpen, targetPath],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className={cn(MARKDOWN_FILE_LINK_CLASS_NAME, className)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleOpen();
            }}
            onContextMenu={handleContextMenu}
          >
            <VscodeEntryIcon
              pathValue={filePath}
              kind="file"
              theme={theme}
              className={cn(MARKDOWN_FILE_LINK_ICON_CLASS_NAME, "text-current")}
            />
            <span className={MARKDOWN_FILE_LINK_LABEL_CLASS_NAME}>{label}</span>
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-[11px] leading-tight"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {targetPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.displayPath === next.displayPath &&
    previous.filePath === next.filePath &&
    previous.label === next.label &&
    previous.theme === next.theme &&
    previous.line === next.line &&
    previous.column === next.column &&
    previous.className === next.className &&
    previous.onOpenFile === next.onOpenFile
  );
}

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  skills = EMPTY_MARKDOWN_SKILLS,
  onOpenFile,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const renderedText = useMemo(() => linkifyPlainFilePaths(text, cwd), [cwd, text]);
  const markdownFileLinkMetaByHref = useMemo(() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(renderedText)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  }, [cwd, renderedText]);
  const fileLinkParentSuffixByPath = useMemo(() => {
    const filePaths = [...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath);
    return buildFileLinkParentSuffixByPath(filePaths);
  }, [markdownFileLinkMetaByHref]);
  const markdownUrlTransform = useCallback((href: string) => {
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
  }, []);
  const markdownComponents = useMemo<Components>(
    () => ({
      p({ node: _node, children, ...props }) {
        return <p {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</p>;
      },
      li({ node: _node, children, ...props }) {
        return <li {...props}>{renderSkillInlineMarkdownChildren(children, skills)}</li>;
      },
      table({ node: _node, children, ...props }) {
        const headerLabels = extractMarkdownTableHeaderLabels(children);
        const tableChildren =
          headerLabels.length > 0 ? enhanceMarkdownTableChildren(children, headerLabels) : children;
        return (
          <div
            className="chat-markdown-table-scroll"
            tabIndex={0}
            aria-label="横向滚动表格"
            data-column-count={headerLabels.length || undefined}
          >
            <table {...props}>{tableChildren}</table>
          </div>
        );
      },
      a({ node: _node, href, ...props }) {
        const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
        const fileLinkMeta = normalizedHref ? markdownFileLinkMetaByHref.get(normalizedHref) : null;
        if (!fileLinkMeta) {
          return (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={href}
              className={cn("chat-markdown-web-link", props.className)}
            />
          );
        }

        const parentSuffix = fileLinkParentSuffixByPath.get(fileLinkMeta.filePath);
        const labelParts = [fileLinkMeta.basename];
        if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
          labelParts.push(parentSuffix);
        }
        if (fileLinkMeta.line) {
          labelParts.push(
            `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
          );
        }

        return (
          <MarkdownFileLink
            href={fileLinkMeta.targetPath}
            targetPath={fileLinkMeta.targetPath}
            displayPath={fileLinkMeta.displayPath}
            filePath={fileLinkMeta.filePath}
            label={labelParts.join(" · ")}
            theme={resolvedTheme}
            line={fileLinkMeta.line}
            column={fileLinkMeta.column}
            className={props.className}
            onOpenFile={onOpenFile}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        if (isStreaming) {
          return (
            <MarkdownCodeBlock
              code={codeBlock.code}
              languageLabel={extractFenceLanguageLabel(codeBlock.className)}
            >
              <pre {...props}>{children}</pre>
            </MarkdownCodeBlock>
          );
        }

        return (
          <MarkdownCodeBlock
            code={codeBlock.code}
            languageLabel={extractFenceLanguageLabel(codeBlock.className)}
          >
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
    }),
    [
      diffThemeName,
      fileLinkParentSuffixByPath,
      isStreaming,
      markdownFileLinkMetaByHref,
      onOpenFile,
      resolvedTheme,
      skills,
    ],
  );

  return (
    <div className="chat-markdown w-full min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
