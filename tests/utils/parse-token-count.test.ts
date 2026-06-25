import { describe, it, expect } from 'vitest'
import { parseTokenCount } from '../../src/utils/parse-token-count.js'
import { formatTokenCount } from '@cc-expand/plugin-context-expand'
import { CcxError, ErrorCode } from '../../src/types/index.js'

describe('parseTokenCount', () => {
  it('parses plain number', () => {
    expect(parseTokenCount('256000')).toBe(256000)
  })

  it('parses comma-separated number', () => {
    expect(parseTokenCount('256,000')).toBe(256000)
  })

  it('parses k suffix', () => {
    expect(parseTokenCount('270k')).toBe(270000)
    expect(parseTokenCount('270K')).toBe(270000)
  })

  it('parses w suffix', () => {
    expect(parseTokenCount('27w')).toBe(270000)
    expect(parseTokenCount('27W')).toBe(270000)
  })

  it('rejects zero', () => {
    expect(() => parseTokenCount('0')).toThrow()
    try {
      parseTokenCount('0')
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ErrorCode.INVALID_TARGET)
    }
  })

  it('rejects negative numbers', () => {
    expect(() => parseTokenCount('-1')).toThrow()
  })

  it('rejects decimals', () => {
    expect(() => parseTokenCount('270.5k')).toThrow()
  })

  it('parses m suffix (million)', () => {
    expect(parseTokenCount('1m')).toBe(1_000_000)
    expect(parseTokenCount('1M')).toBe(1_000_000)
  })

  it('parses multi-segment shortVer (25w6k / 5w9k / 1m23w4k)', () => {
    expect(parseTokenCount('25w6k')).toBe(256000)
    expect(parseTokenCount('5w9k')).toBe(59000)
    // format 丢弃 <1000 余数：1m23w4k 代表 1234000，不是 1234567
    expect(parseTokenCount('1m23w4k')).toBe(1_234_000)
  })

  it('parse(format(n)) is identity for 整千整万 n (ADR 0003 决策 8 双向对称)', () => {
    // format 对 <1000 余数有损，故严格对称仅对整千倍数成立
    for (const n of [270000, 1_000_000, 256000, 59000, 300000, 500]) {
      expect(parseTokenCount(formatTokenCount(n))).toBe(n)
    }
  })

  it('rejects non-numeric strings', () => {
    expect(() => parseTokenCount('abc')).toThrow()
  })
})
