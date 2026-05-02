import { APIUserAbortError } from '@anthropic-ai/sdk'
import { getEmptyToolPermissionContext } from "../Tool.ts"
import type { Message } from "../types/message.ts"
import { logForDebugging } from "../utils/debug.ts"
import {
  createUserMessage,
  getAssistantMessageText,
} from "../utils/messages.ts"
import { getSmallFastModel } from "../utils/model/model.ts"
import { asSystemPrompt } from "../utils/systemPromptType.ts"
import { getResolvedLanguage } from "../utils/language.ts"
import { queryModelWithoutStreaming } from "./api/claude.ts"
import { createTrace, endTrace, isLangfuseEnabled } from "./langfuse/index.ts"
import { getSessionId } from "../bootstrap/state.ts"
import { getAPIProvider } from "../utils/model/providers.ts"
import { getSessionMemoryContent } from "./SessionMemory/sessionMemoryUtils.ts"

// Recap only needs recent context — truncate to avoid "prompt too long" on
// large sessions. 30 messages ≈ ~15 exchanges, plenty for "where we left off."
const RECENT_MESSAGE_WINDOW = 30

const PROMPT_EN =
  'The user stepped away and is coming back. Write exactly 1-3 short sentences. Start by stating the high-level task — what they are building or debugging, not implementation details. Next: the concrete next step. Skip status reports and commit recaps.'

const PROMPT_ZH =
  '用户离开后回来了。用中文写 1-3 句话。先说明用户在做什么（高层目标，不是实现细节），然后说明下一步具体操作。不要写状态报告或提交总结。'

function buildAwaySummaryPrompt(memory: string | null): string {
  const memoryBlock = memory
    ? `Session memory (broader context):\n${memory}\n\n`
    : ''
  const prompt = getResolvedLanguage() === 'zh' ? PROMPT_ZH : PROMPT_EN
  return `${memoryBlock}${prompt}`
}

/**
 * Generates a short session recap for the "while you were away" card.
 * Returns null on abort, empty transcript, or error.
 */
export async function generateAwaySummary(
  messages: readonly Message[],
  signal: AbortSignal,
): Promise<string | null> {
  if (messages.length === 0) {
    return null
  }

  const model = getSmallFastModel()
  const langfuseTrace = isLangfuseEnabled()
    ? createTrace({
        sessionId: getSessionId(),
        model,
        provider: getAPIProvider(),
        name: 'away-summary',
      })
    : null

  try {
    const memory = await getSessionMemoryContent()
    const recent = messages.slice(-RECENT_MESSAGE_WINDOW)
    recent.push(createUserMessage({ content: buildAwaySummaryPrompt(memory) }))
    const response = await queryModelWithoutStreaming({
      messages: recent,
      systemPrompt: asSystemPrompt([]),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal,
      options: {
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        model,
        toolChoice: undefined,
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        agents: [],
        querySource: 'away_summary',
        mcpTools: [],
        skipCacheWrite: true,
        langfuseTrace,
      },
    })

    if (response.isApiErrorMessage) {
      logForDebugging(
        `[awaySummary] API error: ${getAssistantMessageText(response)}`,
      )
      endTrace(langfuseTrace, undefined, 'error')
      return null
    }
    endTrace(langfuseTrace)
    return getAssistantMessageText(response)
  } catch (err) {
    if (err instanceof APIUserAbortError || signal.aborted) {
      return null
    }
    logForDebugging(`[awaySummary] generation failed: ${err}`)
    endTrace(langfuseTrace, undefined, 'error')
    return null
  }
}
