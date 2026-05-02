import {  feature  } from "../../featureFlags.ts";
import * as React from 'react';
import { resetCostState } from "@t3tools/ccb-engine/src/bootstrap/state.ts";
import { clearTrustedDeviceToken, enrollTrustedDevice } from "../../bridge/trustedDevice.ts";
import type { LocalJSXCommandContext } from "../../commands.ts";
import { ConfigurableShortcutHint } from "@t3tools/ccb-engine/src/components/ConfigurableShortcutHint.ts";
import { ConsoleOAuthFlow } from "@t3tools/ccb-engine/src/components/ConsoleOAuthFlow.ts";
import { Dialog } from '@anthropic/ink';
import { useMainLoopModel } from "../../hooks/useMainLoopModel.ts";
import { Text } from '@anthropic/ink';
import { refreshGrowthBookAfterAuthChange } from "@t3tools/ccb-engine/src/services/analytics/growthbook.ts";
import { refreshPolicyLimits } from "@t3tools/ccb-engine/src/services/policyLimits/index.ts";
import { refreshRemoteManagedSettings } from "@t3tools/ccb-engine/src/services/remoteManagedSettings/index.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";
import { stripSignatureBlocks } from "@t3tools/ccb-engine/src/utils/messages.ts";
import {
  checkAndDisableAutoModeIfNeeded,
  resetAutoModeGateCheck,
} from "@t3tools/ccb-engine/src/utils/permissions/bypassPermissionsKillswitch.ts";
import { resetUserCache } from "@t3tools/ccb-engine/src/utils/user.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return (
    <Login
      onDone={async success => {
        context.onChangeAPIKey();
        // Signature-bearing blocks (thinking, connector_text) are bound to the API key â€?
        // strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks);
        if (success) {
          // Post-login refresh logic. Keep in sync with onboarding in src/interactiveHelpers.tsx
          // Reset cost state when switching accounts
          resetCostState();
          // Refresh remotely managed settings after login (non-blocking)
          void refreshRemoteManagedSettings();
          // Refresh policy limits after login (non-blocking)
          void refreshPolicyLimits();
          // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
          resetUserCache();
          // Refresh GrowthBook after login to get updated feature flags (e.g., for claude.ai MCPs)
          refreshGrowthBookAfterAuthChange();
          // Clear any stale trusted device token from a previous account before
          // re-enrolling â€?prevents sending the old token on bridge calls while
          // the async enrollTrustedDevice() is in-flight.
          clearTrustedDeviceToken();
          // Enroll as a trusted device for Remote Control (10-min fresh-session window)
          void enrollTrustedDevice();
          // Reset killswitch gate checks and re-run with new org
          resetAutoModeGateCheck();
          const appState = context.getAppState();
          void checkAndDisableAutoModeIfNeeded(appState.toolPermissionContext, context.setAppState, appState.fastMode);
          // Increment authVersion to trigger re-fetching of auth-dependent data in hooks (e.g., MCP servers)
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }));
        }
        onDone(success ? 'Login successful' : 'Login interrupted');
      }}
    />
  );
}

export function Login(props: {
  onDone: (success: boolean, mainLoopModel: string) => void;
  startingMessage?: string;
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel();

  return (
    <Dialog
      title="Login"
      onCancel={() => props.onDone(false, mainLoopModel)}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        )
      }
    >
      <ConsoleOAuthFlow onDone={() => props.onDone(true, mainLoopModel)} startingMessage={props.startingMessage} />
    </Dialog>
  );
}

