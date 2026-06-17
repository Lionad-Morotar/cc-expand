import { describe, it, expect } from 'vitest'
import { validateTargetInput } from '../../src/utils/validate-target.js'

describe('validateTargetInput', () => {
  it('accepts a 7-digit target that encodes as a shorter literal', () => {
    // 100w → 1000000 → "1e6"(fit 6-byte slot)。旧逻辑按十进制位数拒绝，新逻辑按可编码性通过
    expect(validateTargetInput('100w', '200000')).toBe(true)
  })

  it('accepts a decimal that fits the slot verbatim', () => {
    expect(validateTargetInput('256000', '200000')).toBe(true)
  })

  it('rejects a target that cannot be encoded into the slot', () => {
    // 1234567 在 6 字节内无法等长编码
    const result = validateTargetInput('1234567', '200000')
    expect(result).not.toBe(true)
    expect(typeof result).toBe('string')
  })

  it('rejects an unparseable input with a message', () => {
    const result = validateTargetInput('abc', '200000')
    expect(result).not.toBe(true)
    expect(typeof result).toBe('string')
  })
})
