import { useCallback, useEffect } from 'react'
import { settingsChangeDetector } from "../utils/settings/changeDetector.ts"
import type { SettingSource } from "../utils/settings/constants.ts"
import { getSettings_DEPRECATED } from "../utils/settings/settings.ts"
import type { SettingsJson } from "../utils/settings/types.ts"

export function useSettingsChange(
  onChange: (source: SettingSource, settings: SettingsJson) => void,
): void {
  const handleChange = useCallback(
    (source: SettingSource) => {
      // Cache is already reset by the notifier (changeDetector.fanOut) â€?
      // resetting here caused N-way thrashing with N subscribers: each
      // cleared the cache, re-read from disk, then the next cleared again.
      const newSettings = getSettings_DEPRECATED()
      onChange(source, newSettings)
    },
    [onChange],
  )

  useEffect(
    () => settingsChangeDetector.subscribe(handleChange),
    [handleChange],
  )
}

