import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectConfigFile,
  generateBashFunction,
  generatePowerShellFunction,
  generateShellFunction,
} from '../../src/services/shell-codegen.js'

describe('shell-codegen', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-codegen-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('detects zshrc by default on non-Windows', () => {
    expect(detectConfigFile(tempDir)).toBe(join(tempDir, '.zshrc'))
  })

  it('prefers bashrc when zshrc is absent', () => {
    const bashrc = join(tempDir, '.bashrc')
    require('node:fs').writeFileSync(bashrc, '')
    expect(detectConfigFile(tempDir)).toBe(bashrc)
  })

  it('generates bash function with given target', () => {
    const code = generateBashFunction(256000)
    expect(code).toContain('cc() {')
    expect(code).toContain("alias c='cc 256000'")
    expect(code).toContain('local default_binary="$HOME/.cc-expand/bin/claude-256000"')
  })

  it('generates powershell function with given target', () => {
    const code = generatePowerShellFunction(256000)
    expect(code).toContain('function cc {')
    expect(code).toContain('param([string]$ctx = "256000")')
    expect(code).toContain('function c {')
    expect(code).toContain('cc 256000 @args')
  })

  it('generateShellFunction uses platform-specific backend', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const code = generateShellFunction(270000)
      expect(code).toContain('function cc')
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    }
  })
})
