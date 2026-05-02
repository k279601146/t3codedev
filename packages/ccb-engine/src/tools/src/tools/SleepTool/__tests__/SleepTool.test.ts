// @ts-nocheck
import { beforeEach, describe, expect, test } from 'bun:test'
import { SleepTool } from '../SleepTool.ts'
import {
  enqueue,
  getCommandQueue,
  resetCommandQueue,
} from "../../../../../utils/messageQueueManager.ts"

describe('SleepTool', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  test('declares cancel interrupt behavior', () => {
    expect(SleepTool.interruptBehavior()).toBe('cancel')
  })

  test('wakes early when queued work arrives', async () => {
    const sleepPromise = SleepTool.call({ duration_seconds: 10 }, {
      abortController: new AbortController(),
    } as any)

    setTimeout(() => {
      enqueue({
        value: 'wake up',
        mode: 'prompt',
      })
    }, 20)

    const result = await sleepPromise

    expect(result.data.interrupted).toBe(true)
    expect(result.data.slept_seconds).toBeLessThan(10)
    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]).toMatchObject({
      value: 'wake up',
      mode: 'prompt',
    })
  })
})
