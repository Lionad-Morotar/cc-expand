import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupCommand } from '../../../src/cli/commands/setup.js'

describe('setup command', () => {
  let tempDir: string
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
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

  it('should skip installation when user cancels confirm', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const mockConfirm = vi.fn().mockResolvedValue(false)

    const result = await setupCommand([], {
      homeDir: tempDir,
      confirm: mockConfirm,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toBe('# existing config\n')
    expect(result.success).toBe(true)
    expect(result.summary).toContain('cancelled')
  })

  it('should install when user confirms', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const mockConfirm = vi.fn().mockResolvedValue(true)

    const result = await setupCommand([], {
      homeDir: tempDir,
      confirm: mockConfirm,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(result.success).toBe(true)
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 27w'")
    expect(content).toContain('cc-expand run "$ctx" --print-binary 2>/dev/null')
    expect(content).toContain('cc-expand patch --target "$ctx" --yes || {')
    expect(content).toContain('if [[ -z "$binary" || ! -x "$binary" ]]; then')
  })

  it('should install with --yes without confirm', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const result = await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(zshrc, 'utf-8')
    expect(result.success).toBe(true)
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 27w'")
  })

  it('should backup existing cc function', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, 'cc() { echo old; }\nalias c="oldcmd"\n')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc_backup()')
    expect(content).toContain('alias c_backup=')
    expect(content).toContain('cc()')
  })

  it('should backup multiline cc function', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, 'cc()\n{\n  echo old\n}\n')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc_backup()')
    expect(content).toContain('cc()')
  })

  it('should return error result when cc-expand block already exists', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(
      zshrc,
      '# --- cc-expand generated start ---\ncc() {}\n# --- cc-expand generated end ---\n',
    )

    const result = await setupCommand(['--yes'], { homeDir: tempDir })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PERMISSION_DENIED')
  })

  it('should generate PowerShell function on Windows', async () => {
    setPlatform('win32')

    const psProfileDir = join(tempDir, 'Documents', 'PowerShell')
    mkdirSync(psProfileDir, { recursive: true })
    const psProfile = join(psProfileDir, 'Microsoft.PowerShell_profile.ps1')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(psProfile, 'utf-8')
    expect(content).toContain('function cc')
    expect(content).toContain('Set-Alias')
    expect(content).toContain('function c')
    expect(content).not.toContain('param([string]$args)')
    expect(content).not.toContain('function cc($args)')
    expect(content).toContain('claude-')
  })

  it('should not contain bash syntax in PowerShell output', async () => {
    setPlatform('win32')

    const psProfileDir = join(tempDir, 'Documents', 'PowerShell')
    mkdirSync(psProfileDir, { recursive: true })
    const psProfile = join(psProfileDir, 'Microsoft.PowerShell_profile.ps1')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(psProfile, 'utf-8')
    expect(content).not.toContain('cc() {')
    expect(content).not.toContain("alias c='cc")
    expect(content).not.toContain('local ')
    expect(content).not.toContain('[[ ')
  })
})
