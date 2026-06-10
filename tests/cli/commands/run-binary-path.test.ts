import { describe, it, expect, afterEach } from 'vitest'
import { getRunBinaryPath } from '../../../src/cli/commands/run.js'

describe('getRunBinaryPath', () => {
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

  it('should include .exe extension on Windows', () => {
    setPlatform('win32')
    expect(getRunBinaryPath('270000')).toMatch(/claude-270000\.exe$/)
  })

  it('should have no extension on macOS', () => {
    setPlatform('darwin')
    expect(getRunBinaryPath('270000')).toMatch(/claude-270000$/)
  })

  it('should have no extension on Linux', () => {
    setPlatform('linux')
    expect(getRunBinaryPath('270000')).toMatch(/claude-270000$/)
  })
})
