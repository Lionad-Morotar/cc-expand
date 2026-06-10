import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupCommand } from '../../../src/cli/commands/setup.js'

describe('setup command', () => {
  let tempDir: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    logSpy.mockRestore()
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

    await setupCommand([], {
      homeDir: tempDir,
      confirm: mockConfirm,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toBe('# existing config\n')
    expect(logSpy).toHaveBeenCalledWith('Setup cancelled.')
  })

  it('should install when user confirms', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const mockConfirm = vi.fn().mockResolvedValue(true)

    await setupCommand([], {
      homeDir: tempDir,
      confirm: mockConfirm,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 270000'")
    // 渠道无关的 shell 函数
    expect(content).toContain('$HOME/.cc-expand/bin/claude-${ctx}')
    expect(content).toContain('$HOME/.cc-expand/bin/claude-270000')
    // patch 失败时返回错误
    expect(content).toContain('cc-expand patch --target "$ctx" --yes || {')
    // 默认 binary 不存在时检查
    expect(content).toContain('if [[ ! -x "$default_binary" ]]; then')
  })

  it('should install with --yes without confirm', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 270000'")
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

  it('should error when cc-expand block already exists', async () => {
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(
      zshrc,
      '# --- cc-expand generated start ---\ncc() {}\n# --- cc-expand generated end ---\n',
    )

    await expect(
      setupCommand(['--yes'], { homeDir: tempDir }),
    ).rejects.toThrow('already installed')
  })

  it('should generate PowerShell function on Windows', async () => {
    setPlatform('win32')

    const psProfileDir = join(tempDir, 'Documents', 'PowerShell')
    mkdirSync(psProfileDir, { recursive: true })
    const psProfile = join(psProfileDir, 'Microsoft.PowerShell_profile.ps1')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(psProfile, 'utf-8')
    // 应该是 PowerShell 函数语法，不是 bash
    expect(content).toContain('function cc')
    expect(content).toContain('Set-Alias')
    expect(content).toContain('function c')
    // 不能使用 $args 作为参数名（PowerShell 保留变量）
    expect(content).not.toContain('param([string]$args)')
    expect(content).not.toContain('function cc($args)')
    // 应该包含 .exe 扩展名
    expect(content).toContain('claude-')
  })

  it('should not contain bash syntax in PowerShell output', async () => {
    setPlatform('win32')

    const psProfileDir = join(tempDir, 'Documents', 'PowerShell')
    mkdirSync(psProfileDir, { recursive: true })
    const psProfile = join(psProfileDir, 'Microsoft.PowerShell_profile.ps1')

    await setupCommand(['--yes'], { homeDir: tempDir })

    const content = readFileSync(psProfile, 'utf-8')
    // 不应该包含 bash 特有的语法
    expect(content).not.toContain('cc() {')
    expect(content).not.toContain("alias c='cc")
    expect(content).not.toContain('local ')
    expect(content).not.toContain('[[ ')
  })
})
