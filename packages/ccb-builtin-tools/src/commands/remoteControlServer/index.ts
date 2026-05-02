import {  feature  } from "../../featureFlags.ts";
import { isBridgeEnabled } from "../../bridge/bridgeEnabled.ts"
import type { Command } from "../../commands.ts"

function isEnabled(): boolean {
  if (!feature('BRIDGE_MODE')) {
    return false
  }
  if (feature('DAEMON')) {
    return isBridgeEnabled()
  }
  // DAEMON feature disabled ï¿?still allow the command but warn at runtime
  // that headless/daemon worker mode is unavailable.
  return isBridgeEnabled()
}

const remoteControlServer = {
  type: 'local-jsx',
  name: 'remote-control-server',
  aliases: ['rcs'],
  description:
    'Start a persistent Remote Control server (daemon) that accepts multiple sessions',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('./remoteControlServer.tsx'),
} satisfies Command

export default remoteControlServer

