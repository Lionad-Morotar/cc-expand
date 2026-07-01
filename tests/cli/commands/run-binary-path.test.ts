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
      configurable: true
    })
  }

  it('should include .exe extension on Windows (shortVer input)', () => {
    setPlatform('win32')
    expect(getRunBinaryPath('27w')).toMatch(/claude-27w\.exe$/)
  })

  it('should have no extension on macOS (shortVer input)', () => {
    setPlatform('darwin')
    expect(getRunBinaryPath('27w')).toMatch(/claude-27w$/)
  })

  it('should compose multi-plugin shortVer with - (Linux)', () => {
    setPlatform('linux')
    expect(getRunBinaryPath('27w-flow')).toMatch(/claude-27w-flow$/)
  })
})
