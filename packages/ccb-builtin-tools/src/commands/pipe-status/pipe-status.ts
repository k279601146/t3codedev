import type { LocalCommandCall } from "@t3tools/ccb-engine/src/types/command.ts"
import { getAllSlaveClients } from "../../hooks/useMasterMonitor.ts"
import {
  getPipeDisplayRole,
  getPipeIpc,
  isPipeControlled,
} from "@t3tools/ccb-engine/src/utils/pipeTransport.ts"

export const call: LocalCommandCall = async (_args, context) => {
  const currentState = context.getAppState()

  if (getPipeIpc(currentState).role === 'main') {
    return {
      type: 'text',
      value:
        'Main mode â€?not connected to any CLIs.\nUse /attach <pipe-name> to connect to a sub session.',
    }
  }

  if (isPipeControlled(getPipeIpc(currentState))) {
    return {
      type: 'text',
      value: `${getPipeDisplayRole(getPipeIpc(currentState))} mode â€?controlled by "${getPipeIpc(currentState).attachedBy}".\nAll session data is being reported to the master.`,
    }
  }

  // Master mode
  const slaves = getPipeIpc(currentState).slaves
  const slaveNames = Object.keys(slaves)
  const clients = getAllSlaveClients()

  if (slaveNames.length === 0) {
    return {
      type: 'text',
      value:
        'Master mode but no sub sessions connected.\nUse /attach <pipe-name> to connect.',
    }
  }

  const lines: string[] = [
    `Master mode â€?${slaveNames.length} sub session(s) connected:`,
    '',
  ]

  for (const name of slaveNames) {
    const slave = slaves[name]!
    const client = clients.get(name)
    const connected = client?.connected ? 'connected' : 'disconnected'
    const historyCount = slave.history.length
    const connectedAt = slave.connectedAt.slice(11, 19)

    lines.push(`  ${name}`)
    lines.push(`    Status:    ${slave.status} (${connected})`)
    lines.push(`    Connected: ${connectedAt}`)
    lines.push(`    History:   ${historyCount} entries`)
    lines.push('')
  }

  lines.push('Commands:')
  lines.push('  /send <name> <msg>  â€?Send a task to a sub session')
  lines.push('  /history <name>     â€?View sub session transcript')
  lines.push('  /detach [name]      â€?Disconnect from a sub session (or all)')

  return { type: 'text', value: lines.join('\n') }
}

