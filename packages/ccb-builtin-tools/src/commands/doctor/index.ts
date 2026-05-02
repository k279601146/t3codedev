import type { Command } from "../../commands.ts"
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts"

const doctor: Command = {
  name: 'doctor',
  description: 'Diagnose and verify your Claude Code installation and settings',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_DOCTOR_COMMAND),
  type: 'local-jsx',
  load: () => import('./doctor.tsx'),
}

export default doctor

