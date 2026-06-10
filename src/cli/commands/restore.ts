/**
 * cc-expand restore — 回滚到原始二进制
 */
import { DiscoveryService } from '../../services/discovery.js'
import { BackupService } from '../../services/backup.js'
import { ConfigService } from '../../services/config.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { formatSummary, highlight, formatWarnings, formatNextSteps } from '../output.js'

export interface RestoreOptions {
  discoveryService?: DiscoveryService
  backupService?: BackupService
  configService?: ConfigService
  homeDir?: string
}

export async function restoreCommand(options?: RestoreOptions): Promise<string> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const backupService = options?.backupService ?? new BackupService()
  const configService = options?.configService ?? new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const backupDir = configService.getBackupDir()

  await backupService.restore(binaryPath, backupDir)

  // 检测 shell 快捷方式状态
  const shortcutState = readShortcutState(options?.homeDir)

  const warnings: string[] = []
  const nextSteps: string[] = []

  if (shortcutState.pointsToPatched) {
    warnings.push(
      `Shell 快捷方式 c / cc 仍然指向 patch 版本`,
    )
    if (shortcutState.ccTarget) {
      warnings.push(`  cc() → ${shortcutState.ccTarget}`)
    }
    if (shortcutState.cTarget) {
      warnings.push(`  c alias → ${shortcutState.cTarget}`)
    }
    nextSteps.push('编辑 shell profile，将 cc() 默认指向原版 binary')
    nextSteps.push('或直接使用 `claude` 命令启动原版')
  }

  const parts = [
    formatSummary('OK', 'Restored Claude Code to original binary'),
    '',
    `Binary: ${highlight(binaryPath)}`,
    formatWarnings(warnings),
    formatNextSteps(nextSteps),
  ]

  return parts.join('\n')
}
