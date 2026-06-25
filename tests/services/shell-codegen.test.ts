import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectConfigFile,
  generateBashFunction,
  generatePowerShellFunction,
  generateShellFunction,
  generateRestoredBashFunction,
  generateRestoredShellFunction,
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
    expect(code).toContain("alias c='cc 25w6k'")
    expect(code).toContain('binary="$HOME/.cc-expand/bin/claude-25w6k"')
  })

  it('version-guards against stale patched binaries (no silent outdated runs)', () => {
    // cc 函数跑 binary 前必须校验版本：读 channel.json active version，跑 binary --version
    // 比对，不符则报错（避免静默跑版本孤儿；--version 失败/坏 binary 也算不符）
    const code = generateBashFunction(256000)
    expect(code).toContain('channel.json')
    expect(code).toContain('--version')
  })

  it('generates powershell function with given target', () => {
    const code = generatePowerShellFunction(256000)
    expect(code).toContain('function cc {')
    expect(code).toContain('param([string]$ctx = "25w6k")')
    expect(code).toContain('function c {')
    expect(code).toContain('cc 25w6k @args')
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

  it('generates restored bash function that calls original claude directly', () => {
    const code = generateRestoredBashFunction()
    expect(code).toContain('cc() {')
    expect(code).toContain('claude --dangerously-skip-permissions "$@"')
    expect(code).toContain("alias c='cc'")
    // restore 块不应引用 patched binary 路径
    expect(code).not.toContain('.cc-expand/bin/claude-')
    expect(code).toContain('# --- cc-expand generated start ---')
    expect(code).toContain('# --- cc-expand generated end ---')
  })

  it('generateRestoredShellFunction uses powershell backend on windows', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const code = generateRestoredShellFunction()
      expect(code).toContain('function cc')
      expect(code).toContain('claude --dangerously-skip-permissions @args')
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    }
  })
})
