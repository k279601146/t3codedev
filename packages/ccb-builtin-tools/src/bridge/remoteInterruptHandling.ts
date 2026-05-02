import {  feature  } from "../featureFlags.ts";

export function handleRemoteInterrupt(
  abortController: AbortController | null,
): void {
  if (feature('PROACTIVE') || feature('KAIROS')) {
    const { pauseProactive } =
      require('../proactive/index.ts') as typeof import('../proactive/index.ts')
    pauseProactive()
  }

  abortController?.abort()
}

