import type { ToolUseContext } from "@t3tools/ccb-engine/src/Tool.ts"
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from "@t3tools/ccb-engine/src/types/command.ts"
import { getGlobalConfig, saveGlobalConfig } from "@t3tools/ccb-engine/src/utils/config.ts"
import {
  type PreferredLanguage,
  getLanguageDisplayName,
  getResolvedLanguage,
} from "@t3tools/ccb-engine/src/utils/language.ts"

const VALID_LANGS: readonly PreferredLanguage[] = ['en', 'zh', 'auto']

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const arg = args.trim().toLowerCase()

  if (!arg) {
    const pref = getGlobalConfig().preferredLanguage ?? 'auto'
    const resolved = getResolvedLanguage()
    const suffix =
      pref === 'auto' ? ` â†?${getLanguageDisplayName(resolved)}` : ''
    onDone(`Language: ${getLanguageDisplayName(pref)}${suffix}`, {
      display: 'system',
    })
    return null
  }

  if (!VALID_LANGS.includes(arg as PreferredLanguage)) {
    onDone(`Invalid language "${arg}". Use: en, zh, or auto`, {
      display: 'system',
    })
    return null
  }

  const lang = arg as PreferredLanguage
  saveGlobalConfig(current => ({ ...current, preferredLanguage: lang }))

  const resolved = getResolvedLanguage()
  const suffix = lang === 'auto' ? ` â†?${getLanguageDisplayName(resolved)}` : ''
  onDone(`Language set to ${getLanguageDisplayName(lang)}${suffix}`, {
    display: 'system',
  })
  return null
}

