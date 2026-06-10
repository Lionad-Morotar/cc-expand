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
      configurable: true,
    })
  }

  it('should include .exe extension on Windows', () => {
    setPlatform('win32')
    expect(getPatchedBinaryName(270000)).toBe('claude-270000.exe')
  })

  it('should have no extension on macOS', () => {
    setPlatform('darwin')
    expect(getPatchedBinaryName(270000)).toBe('claude-270000')
  })

  it('should have no extension on Linux', () => {
    setPlatform('linux')
    expect(getPatchedBinaryName(270000)).toBe('claude-270000')
  })
})
