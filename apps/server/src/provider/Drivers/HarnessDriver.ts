/**
 * HarnessDriver — `ProviderDriver` for the CCB (Claude Code Best) engine.
 *
 * This driver natively embeds the CCB Agent engine inside T3Code. Unlike the
 * other drivers which wrap external CLI tools (codex, claude, opencode) via
 * child processes, the Harness driver runs the entire agent loop in-process.
 *
 * Phase 0: Skeleton driver that registers itself in the built-in drivers list
 * and provides a pending provider snapshot. The adapter is a stub that will be
 * fleshed out in Phase 1 when the CCB QueryEngine is wired in.
 *
 * @module provider/Drivers/HarnessDriver
 */
import { HarnessSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { Duration, Effect, Schema, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import type {
  BranchNameGenerationResult,
  CommitMessageGenerationResult,
  PrContentGenerationResult,
  ThreadTitleGenerationResult,
} from "../../git/Services/TextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import {
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { makeHarnessAdapter } from "../Layers/HarnessAdapter.ts";

const DRIVER_KIND = ProviderDriverKind.make("harness");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

const HARNESS_PRESENTATION = {
  displayName: "Harness",
  showInteractionModeToggle: true,
} as const;

export type HarnessDriverEnv = ProviderEventLoggers | ServerConfig;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

/**
 * Build a pending snapshot while the provider status hasn't been checked yet.
 */
function makePendingHarnessProvider(config: HarnessSettings): ServerProviderDraft {
  const checkedAt = new Date().toISOString();
  const models: ServerProviderDraft["models"] = (
    config.customModels.length > 0 ? config.customModels : ["gemini-2.5-flash"]
  ).map((slug) => ({
    slug,
    name: slug,
    isCustom: true,
    capabilities: null,
  }));

  return buildServerProvider({
    presentation: HARNESS_PRESENTATION,
    enabled: config.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: "0.1.0",
      status: "ready",
      auth: { status: config.apiKey ? "authenticated" : "unauthenticated" },
      ...(!config.enabled
        ? { message: "Harness provider is disabled in settings" }
        : !config.apiKey
          ? { message: "API key is not configured" }
          : { message: "Harness provider status has not been checked in this session yet" }),
    },
  });
}

/**
 * Check whether the Harness provider is reachable / usable. For now we
 * just validate that an API key and base URL are configured.
 */
function checkHarnessProviderStatus(
  config: HarnessSettings,
): Effect.Effect<ServerProviderDraft, never, never> {
  return Effect.succeed(makePendingHarnessProvider(config));
}

export const HarnessDriver: ProviderDriver<HarnessSettings, HarnessDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Harness",
    supportsMultipleInstances: true,
  },
  configSchema: HarnessSettings,
  defaultConfig: (): HarnessSettings => Schema.decodeSync(HarnessSettings)({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const eventLoggers = yield* ProviderEventLoggers;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies HarnessSettings;

      const adapter = yield* makeHarnessAdapter(effectiveConfig, {
        instanceId,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });

      // Stub text generation — Phase 3 will integrate CCB's model-based text gen.
      const textGeneration = {
        generateCommitMessage: () =>
          Effect.succeed({ subject: "", body: "" } satisfies CommitMessageGenerationResult),
        generatePrContent: () =>
          Effect.succeed({ title: "", body: "" } satisfies PrContentGenerationResult),
        generateBranchName: () =>
          Effect.succeed({ branch: "" } satisfies BranchNameGenerationResult),
        generateThreadTitle: () =>
          Effect.succeed({ title: "" } satisfies ThreadTitleGenerationResult),
      };

      const checkProvider = checkHarnessProviderStatus(effectiveConfig).pipe(
        Effect.map(stampIdentity),
      );

      const snapshot = yield* makeManagedServerProvider<HarnessSettings>({
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) => stampIdentity(makePendingHarnessProvider(settings)),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Harness snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
