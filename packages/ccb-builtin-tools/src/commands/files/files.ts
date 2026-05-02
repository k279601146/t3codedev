import { relative } from 'path'
import type { ToolUseContext } from "@t3tools/ccb-engine/src/Tool.ts"
import type { LocalCommandResult } from "@t3tools/ccb-engine/src/types/command.ts"
import { getCwd } from "@t3tools/ccb-engine/src/utils/cwd.ts"
import { cacheKeys } from "@t3tools/ccb-engine/src/utils/fileStateCache.ts"

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  const files = context.readFileState ? cacheKeys(context.readFileState) : []

  if (files.length === 0) {
    return { type: 'text' as const, value: 'No files in context' }
  }

  const fileList = files.map(file => relative(getCwd(), file)).join('\n')
  return { type: 'text' as const, value: `Files in context:\n${fileList}` }
}

