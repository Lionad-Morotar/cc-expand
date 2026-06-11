import { describe, it, expect } from 'vitest'
import { normalizeVersion, isValidVersion } from '../../src/utils/version.js'

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
