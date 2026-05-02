import {  feature  } from "../../featureFlags.ts";
import { shouldAutoEnableClaudeInChrome } from "../../utils/claudeInChrome/setup.ts"
import { registerBatchSkill } from "./batch.ts"
import { registerClaudeInChromeSkill } from "./claudeInChrome.ts"
import { registerDebugSkill } from "./debug.ts"
import { registerKeybindingsSkill } from "./keybindings.ts"
import { registerLoremIpsumSkill } from "./loremIpsum.ts"
import { registerRememberSkill } from "./remember.ts"
import { registerSimplifySkill } from "./simplify.ts"
import { registerSkillifySkill } from "./skillify.ts"
import { registerStuckSkill } from "./stuck.ts"
import { registerCronDeleteSkill, registerCronListSkill } from "./cronManage.ts"
import { registerLoopSkill } from "./loop.ts"
import { registerDreamSkill } from "./dream.ts"
import { registerUpdateConfigSkill } from "./updateConfig.ts"
import { registerVerifySkill } from "./verify.ts"

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerStuckSkill()
  registerLoopSkill()
  registerCronListSkill()
  registerCronDeleteSkill()
  registerDreamSkill()
  if (feature('REVIEW_ARTIFACT')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerHunterSkill } = require('./hunter.ts')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.ts')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerClaudeApiSkill } = require('./claudeApi.ts')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerRunSkillGeneratorSkill } = require('./runSkillGenerator.ts')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerRunSkillGeneratorSkill()
  }
}
