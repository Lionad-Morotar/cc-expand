import { describe, it, expect } from 'vitest'
import { parseTokenCount } from '../../src/utils/parse-token-count.js'
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
    expect(() => parseTokenCount('0')).toThrow(CcxError)
    try {
      parseTokenCount('0')
    } catch (e) {
      expect((e as CcxError).code).toBe(ErrorCode.INVALID_TARGET)
    }
  })

  it('rejects negative numbers', () => {
    expect(() => parseTokenCount('-1')).toThrow(CcxError)
  })

  it('rejects decimals', () => {
    expect(() => parseTokenCount('270.5k')).toThrow(CcxError)
  })

  it('rejects non-numeric strings', () => {
    expect(() => parseTokenCount('abc')).toThrow(CcxError)
  })
})
