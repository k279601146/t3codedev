// @ts-nocheck
/**
 * @t3tools/ccb-engine — CCB (Claude Code Best) engine package.
 *
 * This package wraps the core Agent logic extracted from the CCB project
 * (a TypeScript reverse-engineering of Claude Code CLI) for use as a
 * native provider engine inside T3Code.
 *
 * Phase 0: Package skeleton + feature flags.
 * Phase 1: QueryEngine + query loop + API client will be added here.
 *
 * @module ccb-engine
 */

export { feature, setFeatures, getFeatures } from "./featureFlags.ts";
export { QueryEngine, type QueryEngineConfig } from "./QueryEngine.ts";
export { getTools, getAllBaseTools, assembleToolPool } from "./tools.ts";
export { getCommands } from "./commands.ts";
export { getDefaultAppState } from "./state/AppStateStore.ts";
