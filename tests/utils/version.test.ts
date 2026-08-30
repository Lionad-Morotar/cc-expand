import { describe, it, expect } from 'vitest'
import { normalizeVersion, isValidVersion, isVersionGreater, isBytecodeVersion } from '../../src/utils/version.js'

describe('normalizeVersion', () => {
  it('strips leading v from semver', () => {
    expect(normalizeVersion('v2.1.172')).toBe('2.1.172')
  })

  it('preserves plain semver', () => {
    expect(normalizeVersion('2.1.172')).toBe('2.1.172')
  })

  it('preserves latest', () => {
    expect(normalizeVersion('latest')).toBe('latest')
  })

  it('only strips a single leading v', () => {
    expect(normalizeVersion('vv2.1.172')).toBe('v2.1.172')
  })
})

describe('isValidVersion', () => {
  it('accepts latest', () => {
    expect(isValidVersion('latest')).toBe(true)
  })

  it('accepts semver', () => {
    expect(isValidVersion('2.1.172')).toBe(true)
  })

  it('accepts v-prefixed semver', () => {
    expect(isValidVersion('v2.1.172')).toBe(true)
  })

  it('rejects arbitrary strings', () => {
    expect(isValidVersion('not-a-version')).toBe(false)
  })
})

describe('isVersionGreater', () => {
  it('returns true when patch version is newer', () => {
    expect(isVersionGreater('2.1.178', '2.1.177')).toBe(true)
  })

  it('returns false when patch version is older', () => {
    expect(isVersionGreater('2.1.170', '2.1.177')).toBe(false)
  })

  it('returns false when equal', () => {
    expect(isVersionGreater('2.1.177', '2.1.177')).toBe(false)
  })

  it('compares minor version before patch', () => {
    expect(isVersionGreater('2.2.0', '2.1.99')).toBe(true)
    expect(isVersionGreater('2.1.99', '2.2.0')).toBe(false)
  })

  it('compares major version first', () => {
    expect(isVersionGreater('3.0.0', '2.99.99')).toBe(true)
  })

  it('treats missing segments as 0', () => {
    expect(isVersionGreater('2.1', '2.1.0')).toBe(false)
    expect(isVersionGreater('2.1.1', '2.1')).toBe(true)
  })

  it('returns false for malformed versions lacking major.minor (no false "newer")', () => {
    expect(isVersionGreater('2', '2.1.0')).toBe(false)
    expect(isVersionGreater('2.1.x-beta', '2.1.160')).toBe(false)
  })
})

describe('isBytecodeVersion', () => {
  it('returns false for versions before the Bun bytecode cutoff (2.1.245)', () => {
    expect(isBytecodeVersion('2.1.245')).toBe(false)
    expect(isBytecodeVersion('2.1.244')).toBe(false)
  })

  it('returns true from 2.1.246 onward', () => {
    expect(isBytecodeVersion('2.1.246')).toBe(true)
  })

  it('returns true for newer bytecode versions', () => {
    expect(isBytecodeVersion('2.1.250')).toBe(true)
  })
})
