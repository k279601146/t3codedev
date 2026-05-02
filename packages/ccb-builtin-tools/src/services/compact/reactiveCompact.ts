// Auto-generated stub â€?replace with real implementation
export {}

import type { Message } from '../../types/message.ts'
import type { CompactionResult } from "./compact.ts"

export const isReactiveOnlyMode: () => boolean = () => false
export const reactiveCompactOnPromptTooLong: (
  messages: Message[],
  cacheSafeParams: Record<string, unknown>,
  options: { customInstructions?: string; trigger?: string },
) => Promise<{ ok: boolean; reason?: string; result?: CompactionResult }> =
  async () => ({ ok: false })
export const isReactiveCompactEnabled: () => boolean = () => false
export const isWithheldPromptTooLong: (message: Message) => boolean = () =>
  false
export const isWithheldMediaSizeError: (message: Message) => boolean = () =>
  false
export const tryReactiveCompact: (params: {
  hasAttempted: boolean
  querySource: string
  aborted: boolean
  messages: Message[]
  cacheSafeParams: Record<string, unknown>
}) => Promise<CompactionResult | null> = async () => null

