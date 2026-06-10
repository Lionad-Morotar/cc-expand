import { describe, it, expect, afterEach } from 'vitest'
import { getNpmCommand } from '../../src/services/package.js'

describe('getNpmCommand', () => {
  let originalPlatform: PropertyDescriptor | undefined

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  function setPlatform(platform: string) {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    })
  }

  it('should return npm.cmd on Windows', () => {
    setPlatform('win32')
    expect(getNpmCommand()).toBe('npm.cmd')
  })

  it('should return npm on macOS', () => {
    setPlatform('darwin')
    expect(getNpmCommand()).toBe('npm')
  })

  it('should return npm on Linux', () => {
    setPlatform('linux')
    expect(getNpmCommand()).toBe('npm')
  })
})
