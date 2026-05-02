// Host feature gate adapter ï¿?bridges feature() to mcp-client's FeatureGate interface

import type { FeatureGate } from '@claude-code-best/mcp-client/index.ts'
import {  feature  } from "../../../featureFlags.ts";

/**
 * Creates a FeatureGate implementation using the host's feature flag system.
 */
export function createMcpFeatureGate(): FeatureGate {
  return {
    isEnabled(flag: string) {
      return feature(flag)
    },
  }
}

