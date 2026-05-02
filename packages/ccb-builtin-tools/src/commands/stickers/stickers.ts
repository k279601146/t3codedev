import type { LocalCommandResult } from "@t3tools/ccb-engine/src/types/command.ts"
import { openBrowser } from "@t3tools/ccb-engine/src/utils/browser.ts"

export async function call(): Promise<LocalCommandResult> {
  const url = 'https://www.stickermule.com/claudecode'
  const success = await openBrowser(url)

  if (success) {
    return { type: 'text', value: 'Opening sticker page in browserâ€? }
  } else {
    return {
      type: 'text',
      value: `Failed to open browser. Visit: ${url}`,
    }
  }
}

