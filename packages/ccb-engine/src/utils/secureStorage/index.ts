import { createFallbackStorage } from "./fallbackStorage.ts"
import { macOsKeychainStorage } from "./macOsKeychainStorage.ts"
import { plainTextStorage } from "./plainTextStorage.ts"
import type { SecureStorage } from "./types.ts"

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  // TODO: add libsecret support for Linux

  return plainTextStorage
}
