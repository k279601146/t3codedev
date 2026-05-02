import { getGlobalConfig } from "./config.ts"
import { getSystemLocaleLanguage } from "./intl.ts"

export type PreferredLanguage = 'auto' | 'en' | 'zh'
export type ResolvedLanguage = 'en' | 'zh'

/**
 * Resolve the effective display language.
 * Priority: GlobalConfig.preferredLanguage â†?system locale â†?default 'en'.
 */
export function getResolvedLanguage(): ResolvedLanguage {
  const pref = getGlobalConfig().preferredLanguage ?? 'auto'
  if (pref === 'en' || pref === 'zh') return pref
  const sysLang = getSystemLocaleLanguage()
  return sysLang === 'zh' ? 'zh' : 'en'
}

const DISPLAY_NAMES: Record<string, string> = {
  auto: 'Auto (follow system)',
  en: 'English',
  zh: 'ä¸­æ–‡',
}

export function getLanguageDisplayName(lang: string): string {
  return DISPLAY_NAMES[lang] ?? lang
}

