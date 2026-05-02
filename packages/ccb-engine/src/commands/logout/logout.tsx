import * as React from 'react';
import { clearTrustedDeviceTokenCache } from "../../bridge/trustedDevice.ts";
import { Text } from '@anthropic/ink';
import { refreshGrowthBookAfterAuthChange } from "../../services/analytics/growthbook.ts";
import { getGroveNoticeConfig, getGroveSettings } from "../../services/api/grove.ts";
import { clearPolicyLimitsCache } from "../../services/policyLimits/index.ts";
// flushTelemetry is loaded lazily to avoid pulling in ~1.1MB of OpenTelemetry at startup
import { clearRemoteManagedSettingsCache } from "../../services/remoteManagedSettings/index.ts";
import { getClaudeAIOAuthTokens, removeApiKey } from "../../utils/auth.ts";
import { clearBetasCaches } from "../../utils/betas.ts";
import { saveGlobalConfig } from "../../utils/config.ts";
import { gracefulShutdownSync } from "../../utils/gracefulShutdown.ts";
import { getSecureStorage } from "../../utils/secureStorage/index.ts";
import { clearToolSchemaCache } from "../../utils/toolSchemaCache.ts";
import { resetUserCache } from "../../utils/user.ts";

export async function performLogout({ clearOnboarding = false }): Promise<void> {
  // Flush telemetry BEFORE clearing credentials to prevent org data leakage
  const { flushTelemetry } = await import('../../utils/telemetry/instrumentation.ts');
  await flushTelemetry();

  await removeApiKey();

  // Wipe all secure storage data on logout
  const secureStorage = getSecureStorage();
  secureStorage.delete();

  await clearAuthRelatedCaches();
  saveGlobalConfig(current => {
    const updated = { ...current };
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false;
      updated.subscriptionNoticeCount = 0;
      updated.hasAvailableSubscription = false;
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: [],
        };
      }
    }
    updated.oauthAccount = undefined;
    return updated;
  });
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
  // Clear the OAuth token cache
  getClaudeAIOAuthTokens.cache?.clear?.();
  clearTrustedDeviceTokenCache();
  clearBetasCaches();
  clearToolSchemaCache();

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache();
  refreshGrowthBookAfterAuthChange();

  // Clear Grove config cache
  getGroveNoticeConfig.cache?.clear?.();
  getGroveSettings.cache?.clear?.();

  // Clear remotely managed settings cache
  await clearRemoteManagedSettingsCache();

  // Clear policy limits cache
  await clearPolicyLimitsCache();
}

export async function call(): Promise<React.ReactNode> {
  await performLogout({ clearOnboarding: true });

  const message = <Text>Successfully logged out from your Anthropic account.</Text>;

  setTimeout(() => {
    gracefulShutdownSync(0, 'logout');
  }, 200);

  return message;
}
