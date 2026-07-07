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
      findClaudeBinary: vi.fn().mockResolvedValue(binaryPath)
    }
    const mockBackup = {
      restore: vi.fn().mockResolvedValue(undefined)
    }
    const mockConfig = {
      getBackupDir: vi.fn().mockReturnValue(backupDir)
    }

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('restore')
    expect(result.data?.binaryPath).toBe(binaryPath)
    expect(result.data?.shortcutsStillPointToPatched).toBe(false)
    expect(mockBackup.restore).toHaveBeenCalledWith(binaryPath, backupDir)
  })

  it('warns when shortcuts point to patched and autoMaintain is disabled', async () => {
    const binaryPath = join(tempDir, 'claude')
    const backupDir = join(tempDir, '.cc-expand', 'backups')
    const zshrc = join(tempDir, '.zshrc')

    // 写入包含 cc-expand 快捷方式的 profile（指向 patched binary）
    writeFileSync(zshrc, `
cc() {
  local default_binary="$HOME/.cc-expand/bin/claude-270000"
  "$default_binary" \$default_flags "$@"
}
alias c='cc 270000'
`)

    const mockDiscovery = { findClaudeBinary: vi.fn().mockResolvedValue(binaryPath) }
    const mockBackup = { restore: vi.fn().mockResolvedValue(undefined) }
    const mockConfig = { getBackupDir: vi.fn().mockReturnValue(backupDir) }
    const mockUserConfig = { get: vi.fn().mockReturnValue(false) }
    const mockMaintain = vi.fn()

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any,
      userConfigService: mockUserConfig as any,
      maintain: mockMaintain,
      homeDir: tempDir
    })

    expect(result.success).toBe(true)
    expect(result.data?.shortcutsStillPointToPatched).toBe(true)
    expect(result.data?.shortcutsUpdated).toBe(false)
    expect(result.warnings?.length).toBeGreaterThan(0)
    expect(result.warnings?.[0]).toContain('still point')
    // autoMaintain 关闭时不应调用 maintain
    expect(mockMaintain).not.toHaveBeenCalled()
  })

  it('overwrites shortcuts to launch original when autoMaintain is enabled', async () => {
    const binaryPath = join(tempDir, 'claude')
    const backupDir = join(tempDir, '.cc-expand', 'backups')
    const zshrc = join(tempDir, '.zshrc')

    writeFileSync(zshrc, `
cc() {
  local default_binary="$HOME/.cc-expand/bin/claude-270000"
  "$default_binary" \$default_flags "$@"
}
alias c='cc 270000'
`)

    const mockDiscovery = { findClaudeBinary: vi.fn().mockResolvedValue(binaryPath) }
    const mockBackup = { restore: vi.fn().mockResolvedValue(undefined) }
    const mockConfig = { getBackupDir: vi.fn().mockReturnValue(backupDir) }
    const mockUserConfig = { get: vi.fn().mockReturnValue(true) }
    const mockMaintain = vi.fn().mockResolvedValue('Shell 快捷方式已更新为指向原版')

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any,
      userConfigService: mockUserConfig as any,
      maintain: mockMaintain,
      homeDir: tempDir
    })

    expect(result.success).toBe(true)
    expect(result.data?.shortcutsUpdated).toBe(true)
    expect(result.data?.shortcutsStillPointToPatched).toBe(false)
    expect(result.data?.maintainSummary).toBe('Shell 快捷方式已更新为指向原版')
    // autoMaintain 已表达"自动维护"，应以 skipConfirm 直接覆盖
    expect(mockMaintain).toHaveBeenCalledWith({ skipConfirm: true, homeDir: tempDir })
    // 维护成功后不应再有警告
    expect(result.warnings).toBeUndefined()
  })

  it('does not touch shortcuts when they do not point to patched', async () => {
    const binaryPath = join(tempDir, 'claude')
    const backupDir = join(tempDir, '.cc-expand', 'backups')

    const mockDiscovery = { findClaudeBinary: vi.fn().mockResolvedValue(binaryPath) }
    const mockBackup = { restore: vi.fn().mockResolvedValue(undefined) }
    const mockConfig = { getBackupDir: vi.fn().mockReturnValue(backupDir) }
    const mockUserConfig = { get: vi.fn().mockReturnValue(true) }
    const mockMaintain = vi.fn()

    const result = await restoreCommand({
      discoveryService: mockDiscovery as any,
      backupService: mockBackup as any,
      configService: mockConfig as any,
      userConfigService: mockUserConfig as any,
      maintain: mockMaintain,
      homeDir: tempDir
    })

    expect(result.data?.shortcutsUpdated).toBe(false)
    expect(result.data?.shortcutsStillPointToPatched).toBe(false)
    expect(mockMaintain).not.toHaveBeenCalled()
  })
})
