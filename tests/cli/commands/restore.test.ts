import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restoreCommand } from '../../../src/cli/commands/restore.js'

describe('restore command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-restore-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir

    // 创建必要的目录结构
    const backupDir = join(tempDir, '.cc-expand', 'backups')
    const binDir = join(tempDir, '.cc-expand', 'bin')
    mkdirSync(backupDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns structured result on successful restore', async () => {
    const binaryPath = join(tempDir, 'claude')
    const backupDir = join(tempDir, '.cc-expand', 'backups')

    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue(binaryPath),
    }
    const mockBackup = {
      restore: vi.fn().mockResolvedValue(undefined),
    }
    const mockConfig = {
      getBackupDir: vi.fn().mockReturnValue(backupDir),
    }

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any,
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('restore')
    expect(result.data?.binaryPath).toBe(binaryPath)
    expect(result.data?.shortcutsStillPointToPatched).toBe(false)
    expect(mockBackup.restore).toHaveBeenCalledWith(binaryPath, backupDir)
  })

  it('warns when shell shortcuts still point to patched binary', async () => {
    const binaryPath = join(tempDir, 'claude')
    const backupDir = join(tempDir, '.cc-expand', 'backups')
    const zshrc = join(tempDir, '.zshrc')

    // 写入包含 cc-expand 快捷方式的 profile
    writeFileSync(zshrc, `
cc() {
  local default_binary="$HOME/.cc-expand/bin/claude-270000"
  "$default_binary" \$default_flags "$@"
}
alias c='cc 270000'
`)

    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue(binaryPath),
    }
    const mockBackup = {
      restore: vi.fn().mockResolvedValue(undefined),
    }
    const mockConfig = {
      getBackupDir: vi.fn().mockReturnValue(backupDir),
    }

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any,
      homeDir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.data?.shortcutsStillPointToPatched).toBe(true)
    expect(result.warnings?.length).toBeGreaterThan(0)
    expect(result.warnings?.[0]).toContain('still point')
  })
})
