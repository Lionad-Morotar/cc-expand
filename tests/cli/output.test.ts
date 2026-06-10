import { describe, it, expect } from 'vitest'
import { formatSummary, highlight, formatWarnings, formatNextSteps } from '../../src/cli/output.js'

describe('formatSummary', () => {
  it('returns [OK] prefix for success status', () => {
    expect(formatSummary('OK', 'Restored successfully')).toBe('[OK] Restored successfully')
  })
})

describe('highlight', () => {
  it('wraps text in ANSI cyan color code', () => {
    expect(highlight('2.1.170')).toBe('\x1b[36m2.1.170\x1b[0m')
  })
})

describe('formatWarnings', () => {
  it('returns empty string for empty warnings', () => {
    expect(formatWarnings([])).toBe('')
  })

  it('formats single warning with prefix', () => {
    const result = formatWarnings(['Shell shortcuts still point to patched'])
    expect(result).toContain('⚠')
    expect(result).toContain('Shell shortcuts still point to patched')
  })

  it('formats multiple warnings', () => {
    const result = formatWarnings(['Warning 1', 'Warning 2'])
    expect(result).toContain('Warning 1')
    expect(result).toContain('Warning 2')
  })
})

describe('formatNextSteps', () => {
  it('returns empty string for empty steps', () => {
    expect(formatNextSteps([])).toBe('')
  })

  it('formats single step with number', () => {
    const result = formatNextSteps(['Run cc-expand status'])
    expect(result).toContain('1.')
    expect(result).toContain('Run cc-expand status')
  })

  it('formats multiple steps', () => {
    const result = formatNextSteps(['Step A', 'Step B'])
    expect(result).toContain('1.')
    expect(result).toContain('2.')
    expect(result).toContain('Step A')
    expect(result).toContain('Step B')
  })
})
