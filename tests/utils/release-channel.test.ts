import { describe, it, expect } from 'vitest'
import { getReleaseChannel } from '../../src/utils/release-channel.js'

describe('getReleaseChannel', () => {
  it('alpha prerelease → alpha', () => {
    expect(getReleaseChannel('0.4.0-alpha.1')).toBe('alpha')
  })
  it('beta → beta', () => {
    expect(getReleaseChannel('1.0.0-beta.3')).toBe('beta')
  })
  it('rc → rc', () => {
    expect(getReleaseChannel('2.0.0-rc.0')).toBe('rc')
  })
  it('stable → latest', () => {
    expect(getReleaseChannel('0.3.9')).toBe('latest')
  })
  it('非标准 prerelease（数字标识）→ latest', () => {
    expect(getReleaseChannel('0.4.0-0')).toBe('latest')
  })
  it('无效版本 → latest', () => {
    expect(getReleaseChannel('invalid')).toBe('latest')
  })
})
