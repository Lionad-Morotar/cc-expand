import { describe, it, expect } from 'vitest'
import { encodeTokenLiteral } from '../../src/utils/encode-token-literal.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

describe('encodeTokenLiteral', () => {
  it('encodes a decimal that fits the slot verbatim', () => {
    expect(encodeTokenLiteral(256000, 6)).toBe('256000')
  })

  it('falls back to scientific notation when decimal exceeds the slot', () => {
    // 1000000 → "1e6"(3B) + 空格 pad 到 6
    expect(encodeTokenLiteral(1000000, 6)).toBe('1e6   ')
  })

  it('keeps the mantissa when the exponent form needs a decimal', () => {
    // 1500000 → "1.5e6"(5B) + 空格 pad 到 6
    expect(encodeTokenLiteral(1500000, 6)).toBe('1.5e6 ')
  })

  it('throws INVALID_TARGET when no candidate fits the slot', () => {
    // 1234567: "1234567"(7), "1.234567e6"(10) 都 > 6 → 无法等长编码
    let thrown: unknown
    try {
      encodeTokenLiteral(1234567, 6)
    } catch (e) {
      thrown = e
    }
    expect((thrown as { code?: string }).code).toBe(ErrorCode.INVALID_TARGET)
  })

  it('preserves length and runtime value invariants across encodable targets', () => {
    // 长度恒 === slotWidth；字面量求值恒 === target（含 7 位目标）
    for (const target of [256000, 999999, 1000000, 1500000, 2000000, 5000000]) {
      const encoded = encodeTokenLiteral(target, 6)
      expect(encoded.length).toBe(6)
      expect(Number(encoded.trim())).toBe(target)
    }
  })
})
