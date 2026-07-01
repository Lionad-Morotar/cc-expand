import { describe, it, expect, afterEach } from 'vitest'
import { getPatchedBinaryName } from '../../../src/cli/commands/patch.js'

describe('getPatchedBinaryName', () => {
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
    expect(getPatchedBinaryName('27w')).toBe('claude-27w.exe')
  })

  it('should have no extension on macOS (shortVer input)', () => {
    setPlatform('darwin')
    expect(getPatchedBinaryName('27w')).toBe('claude-27w')
  })

  it('should compose multi-plugin shortVer with - (Linux)', () => {
    setPlatform('linux')
    expect(getPatchedBinaryName('27w-flow')).toBe('claude-27w-flow')
  })
})
