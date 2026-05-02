// @ts-nocheck
/**
 * CCB Engine feature flags.
 *
 * Replaces the compile-time `feature()` from `bun:bundle` with a runtime
 * configuration object. CCB source files that originally imported
 * `import {  feature  } from "./featureFlags.ts";` should instead import from here.
 *
 * All flags default to `false` (disabled). Enable selectively as features
 * are validated within the T3Code integration.
 */

const ccbFeatures: Record<string, boolean> = {
  // ── Compaction ──────────────────────────────────────────────────────
  /** Reactive compaction: recover from prompt-too-long by compacting on the fly. */
  REACTIVE_COMPACT: true,
  /** Snip-based history pruning (lightweight alternative to full compaction). */
  HISTORY_SNIP: true,
  /** Cached microcompact: cache-aware tool result editing. */
  CACHED_MICROCOMPACT: false,
  /** Context collapse: staged, progressive context reduction. */
  CONTEXT_COLLAPSE: false,

  // ── Agent / orchestration ──────────────────────────────────────────
  /** Multi-agent coordinator mode. */
  COORDINATOR_MODE: false,
  /** Proactive agent behaviours (cron, sleep-tool). */
  PROACTIVE: false,
  /** Background sessions / Kairos mode. */
  KAIROS: false,
  /** Background sessions �?GitHub webhook integration. */
  KAIROS_GITHUB_WEBHOOKS: false,
  /** Background sessions �?push notifications. */
  KAIROS_PUSH_NOTIFICATION: false,
  /** Background agent triggers (remote). */
  AGENT_TRIGGERS_REMOTE: false,

  // ── Tools ──────────────────────────────────────────────────────────
  /** Token budget auto-continue (+500K). */
  TOKEN_BUDGET: true,
  /** Streaming tool execution (overlapping model + tool I/O). */
  // STREAMING_TOOL_EXECUTION: false,   // handled by config gate
  /** Overflow test tool (dev-only). */
  OVERFLOW_TEST_TOOL: false,
  /** Terminal panel capture tool. */
  TERMINAL_PANEL: false,
  /** Web browser tool. */
  WEB_BROWSER_TOOL: false,
  /** Monitor tool. */
  MONITOR_TOOL: false,
  /** Review artifact tool. */
  REVIEW_ARTIFACT: false,
  /** Workflow scripts tool. */
  WORKFLOW_SCRIPTS: false,
  /** Experimental skill search / discovery. */
  EXPERIMENTAL_SKILL_SEARCH: false,

  // ── Misc ───────────────────────────────────────────────────────────
  /** Background sessions (task summary). */
  BG_SESSIONS: false,
  /** Transcript classifier for auto-mode. */
  TRANSCRIPT_CLASSIFIER: false,
  /** Connector text blocks (internal). */
  CONNECTOR_TEXT: false,
  /** Templates / job classifier. */
  TEMPLATES: false,
  /** UDS inbox for peer communication. */
  UDS_INBOX: false,
  /** Cache-breaking command (ant-only). */
  BREAK_CACHE_COMMAND: false,
};

/**
 * Runtime feature flag check �?drop-in replacement for `bun:bundle`'s
 * compile-time `feature()`.
 *
 * Unlike the original, this always returns a boolean (never eliminates code).
 * Feature-gated `require()` calls should be converted to dynamic `import()`
 * guarded by `if (feature('FLAG'))`.
 */
export function feature(name: string): boolean {
  return ccbFeatures[name] ?? false;
}

/**
 * Override one or more feature flags at runtime. Useful for per-session
 * configuration from T3Code's HarnessConfig.
 */
export function setFeatures(overrides: Record<string, boolean>): void {
  for (const [key, value] of Object.entries(overrides)) {
    ccbFeatures[key] = value;
  }
}

/**
 * Return a snapshot of all current feature flag values.
 */
export function getFeatures(): Readonly<Record<string, boolean>> {
  return { ...ccbFeatures };
}

