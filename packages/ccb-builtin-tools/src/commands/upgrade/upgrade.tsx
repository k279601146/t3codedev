import * as React from 'react';
import type { LocalJSXCommandContext } from "../../commands.ts";
import { getOauthProfileFromOauthToken } from "@t3tools/ccb-engine/src/services/oauth/getOauthProfile.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";
import { getClaudeAIOAuthTokens, isClaudeAISubscriber } from "@t3tools/ccb-engine/src/utils/auth.ts";
import { openBrowser } from "@t3tools/ccb-engine/src/utils/browser.ts";
import { logError } from "@t3tools/ccb-engine/src/utils/log.ts";
import { Login } from "../login/login.tsx";

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  try {
    // Check if user is already on the highest Max plan (20x)
    if (isClaudeAISubscriber()) {
      const tokens = getClaudeAIOAuthTokens();
      let isMax20x = false;

      if (tokens?.subscriptionType && tokens?.rateLimitTier) {
        isMax20x = tokens.subscriptionType === 'max' && tokens.rateLimitTier === 'default_claude_max_20x';
      } else if (tokens?.accessToken) {
        const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
        isMax20x =
          profile?.organization?.organization_type === 'claude_max' &&
          profile?.organization?.rate_limit_tier === 'default_claude_max_20x';
      }

      if (isMax20x) {
        setTimeout(
          onDone,
          0,
          'You are already on the highest Max subscription plan. For additional usage, run /login to switch to an API usage-billed account.',
        );
        return null;
      }
    }

    const url = 'https://claude.ai/upgrade/max';
    await openBrowser(url);

    return (
      <Login
        startingMessage={'Starting new login following /upgrade. Exit with Ctrl-C to use existing account.'}
        onDone={success => {
          context.onChangeAPIKey();
          onDone(success ? 'Login successful' : 'Login interrupted');
        }}
      />
    );
  } catch (error) {
    logError(error as Error);
    setTimeout(onDone, 0, 'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.');
  }
  return null;
}

