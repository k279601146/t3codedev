// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { extractGlobBaseDirectory } from '../glob.ts'

describe('extractGlobBaseDirectory', () => {
  test('extracts base dir from glob with *', () => {
    const result = extractGlobBaseDirectory('../../utils/*.ts')
    expect(result.baseDir).toBe('../../utils')
    expect(result.relativePattern).toBe('*.ts')
  })

  test('extracts base dir from glob with **', () => {
    const result = extractGlobBaseDirectory('../../**/*.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('**/*.ts')
  })

  test('returns dirname for literal path', () => {
    const result = extractGlobBaseDirectory('../../utils/file.ts')
    expect(result.baseDir).toBe('../../utils')
    expect(result.relativePattern).toBe('file.ts')
  })

  test('handles glob starting with pattern', () => {
    const result = extractGlobBaseDirectory('*.ts')
    expect(result.baseDir).toBe('')
    expect(result.relativePattern).toBe('*.ts')
  })

  test('handles braces pattern', () => {
    const result = extractGlobBaseDirectory('../../{a,b}/*.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('{a,b}/*.ts')
  })

  test('handles question mark pattern', () => {
    const result = extractGlobBaseDirectory('../../?.ts')
    expect(result.baseDir).toBe('src')
    expect(result.relativePattern).toBe('?.ts')
  })
})
