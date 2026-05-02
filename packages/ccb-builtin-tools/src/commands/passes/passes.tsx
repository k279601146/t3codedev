import * as React from 'react';
import { Passes } from "@t3tools/ccb-engine/src/components/Passes/Passes.ts";
import { logEvent } from "@t3tools/ccb-engine/src/services/analytics/index.ts";
import { getCachedRemainingPasses } from "@t3tools/ccb-engine/src/services/api/referral.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";
import { getGlobalConfig, saveGlobalConfig } from "@t3tools/ccb-engine/src/utils/config.ts";

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // Mark that user has visited /passes so we stop showing the upsell
  const config = getGlobalConfig();
  const isFirstVisit = !config.hasVisitedPasses;
  if (isFirstVisit) {
    const remaining = getCachedRemainingPasses();
    saveGlobalConfig(current => ({
      ...current,
      hasVisitedPasses: true,
      passesLastSeenRemaining: remaining ?? current.passesLastSeenRemaining,
    }));
  }
  logEvent('tengu_guest_passes_visited', { is_first_visit: isFirstVisit });
  return <Passes onDone={onDone} />;
}

