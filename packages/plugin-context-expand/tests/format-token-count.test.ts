import { describe, it, expect } from 'vitest'
import { formatTokenCount } from '../src/format-token-count.js'

describe('formatTokenCount', () => {
  it('formats 270000 as 27w', () => {
    expect(formatTokenCount(270000)).toBe('27w')
  })

  it('formats 1000000 as 1m', () => {
    expect(formatTokenCount(1000000)).toBe('1m')
  })

  it('formats multi-segment values (59000 as 5w9k)', () => {
    expect(formatTokenCount(59000)).toBe('5w9k')
  })

  it('formats 256000 as 25w6k', () => {
    expect(formatTokenCount(256000)).toBe('25w6k')
  })

  it('discards sub-1000 remainder (1234567 as 1m23w4k)', () => {
    expect(formatTokenCount(1234567)).toBe('1m23w4k')
  })

  it('passes through values < 1000 as plain number', () => {
    expect(formatTokenCount(500)).toBe('500')
    expect(formatTokenCount(0)).toBe('0')
  })
})
