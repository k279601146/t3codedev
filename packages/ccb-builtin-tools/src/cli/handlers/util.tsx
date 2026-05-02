/**
 * Miscellaneous subcommand handlers â€?extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { cwd } from 'process';
import React from 'react';
import { WelcomeV2 } from "@t3tools/ccb-engine/src/components/LogoV2/WelcomeV2.ts";
import { useManagePlugins } from "../../hooks/useManagePlugins.ts";
import type { Root } from '@anthropic/ink';
import { Box, Text } from '@anthropic/ink';
import { KeybindingSetup } from "../../keybindings/KeybindingProviderSetup.tsx";
import { logEvent } from "@t3tools/ccb-engine/src/services/analytics/index.ts";
import { MCPConnectionManager } from "@t3tools/ccb-engine/src/services/mcp/MCPConnectionManager.tsx";
import { AppStateProvider } from "@t3tools/ccb-engine/src/state/AppState.tsx";
import { onChangeAppState } from "@t3tools/ccb-engine/src/state/onChangeAppState.ts";
import { isAnthropicAuthEnabled } from "@t3tools/ccb-engine/src/utils/auth.ts";

export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {});

  const showAuthWarning = !isAnthropicAuthEnabled();
  const { ConsoleOAuthFlow } = await import('../../components/ConsoleOAuthFlow.js');
  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider onChangeAppState={onChangeAppState}>
        <KeybindingSetup>
          <Box flexDirection="column" gap={1}>
            <WelcomeV2 />
            {showAuthWarning && (
              <Box flexDirection="column">
                <Text color="warning">
                  Warning: You already have authentication configured via environment variable or API key helper.
                </Text>
                <Text color="warning">
                  The setup-token command will create a new OAuth token which you can use instead.
                </Text>
              </Box>
            )}
            <ConsoleOAuthFlow
              onDone={() => {
                void resolve();
              }}
              mode="setup-token"
              startingMessage="This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required."
            />
          </Box>
        </KeybindingSetup>
      </AppStateProvider>,
    );
  });
  root.unmount();
  process.exit(0);
}

// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() => import('../../screens/Doctor.js').then(m => ({ default: m.Doctor })));

function DoctorWithPlugins({ onDone }: { onDone: () => void }): React.ReactNode {
  useManagePlugins();
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  );
}

export async function doctorHandler(root: Root): Promise<void> {
  logEvent('tengu_doctor_command', {});

  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager dynamicMcpConfig={undefined} isStrictMcpConfig={false}>
            <DoctorWithPlugins
              onDone={() => {
                void resolve();
              }}
            />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    );
  });
  root.unmount();
  process.exit(0);
}

// install handler
export async function installHandler(target: string | undefined, options: { force?: boolean }): Promise<void> {
  const { setup } = await import('../../setup.ts');
  await setup(cwd(), 'default', false, false, undefined, false);
  const { install } = await import('../../commands/install.tsx');
  await new Promise<void>(resolve => {
    const args: string[] = [];
    if (target) args.push(target);
    if (options.force) args.push('--force');

    void install.call(
      result => {
        void resolve();
        process.exit(result.includes('failed') ? 1 : 0);
      },
      {},
      args,
    );
  });
}

