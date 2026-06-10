import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupCommand } from '../../../src/cli/commands/setup.js'

describe('setup command', () => {
  let tempDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

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
})
