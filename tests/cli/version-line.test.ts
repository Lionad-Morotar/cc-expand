import { describe, it, expect } from 'vitest'
import { formatVersionLine } from '../../src/cli/version-line.js'

describe('formatVersionLine', () => {
  it('renders combos when present', () => {
    const line = formatVersionLine({
      version: '2.1.186',
      installed: true,
      patched: true,
      combos: ['27w-flow'],
      targets: [270000]
    })
    expect(line).toContain('27w-flow')
    expect(line).not.toContain('270000')
  })

  it('falls back to targets when combos are absent', () => {
    const line = formatVersionLine({
      version: '2.1.186',
      patched: true,
      targets: [270000]
    })
    expect(line).toContain('270000')
  })

  it('falls back to targets when combos are empty', () => {
    const line = formatVersionLine({
      version: '2.1.186',
      patched: true,
      combos: [],
      targets: [270000]
    })
    expect(line).toContain('270000')
  })

  it('does not render arrow when neither combos nor targets exist', () => {
    const line = formatVersionLine({
      version: '2.1.186',
      installed: true
    })
    expect(line).not.toContain('→')
  })
})
