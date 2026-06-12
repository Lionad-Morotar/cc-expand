import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maintainShellShortcuts } from '../../src/services/shell-maintain.js'
import { generateShellFunction } from '../../src/services/shell-codegen.js'

describe('shell-maintain', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-maintain-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates profile and appends block when missing', async () => {
    const summary = await maintainShellShortcuts({
      homeDir: tempDir,
      targetTokens: 270000,
      skipConfirm: true,
    })

    const zshrc = join(tempDir, '.zshrc')
    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('# --- cc-expand generated start ---')
    expect(content).toContain("alias c='cc 270000'")
    expect(summary).toContain('已安装')
  })

  it('skips when block is already up to date', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, generateShellFunction(270000))

    const summary = await maintainShellShortcuts({
      homeDir: tempDir,
      targetTokens: 270000,
      skipConfirm: true,
    })

    expect(summary).toContain('已是最新')
  })

  it('overwrites outdated block when skipConfirm is true', async () => {
    const zshrc = join(tempDir, '.zshrc')
    const block = [
      '# --- cc-expand generated start ---',
      'cc() {',
      '  :',
      '}',
      "alias c='cc 256000'",
      '# --- cc-expand generated end ---',
    ].join('\n')
    writeFileSync(zshrc, block)

    const summary = await maintainShellShortcuts({
      homeDir: tempDir,
      targetTokens: 270000,
      skipConfirm: true,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain("alias c='cc 270000'")
    expect(content).not.toContain("alias c='cc 256000'")
    expect(summary).toContain('已更新')
  })

  it('cancels overwrite when user declines', async () => {
    const zshrc = join(tempDir, '.zshrc')
    const block = [
      '# --- cc-expand generated start ---',
      'cc() {',
      '  :',
      '}',
      "alias c='cc 256000'",
      '# --- cc-expand generated end ---',
    ].join('\n')
    writeFileSync(zshrc, block)

    const summary = await maintainShellShortcuts({
      homeDir: tempDir,
      targetTokens: 270000,
      confirm: async () => false,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain("alias c='cc 256000'")
    expect(summary).toContain('未更新')
  })

  it('updates powershell profile on windows', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    try {
      const psDir = join(tempDir, 'Documents', 'PowerShell')
      mkdirSync(psDir, { recursive: true })

      const summary = await maintainShellShortcuts({
        homeDir: tempDir,
        targetTokens: 270000,
        skipConfirm: true,
      })

      const psProfile = join(psDir, 'Microsoft.PowerShell_profile.ps1')
      const content = readFileSync(psProfile, 'utf-8')
      expect(content).toContain('function cc')
      expect(content).toContain('cc 270000 @args')
      expect(summary).toContain('已安装')
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    }
  })
})
