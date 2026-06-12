/**
 * cc-expand restore — 回滚到原始二进制
 */
import { DiscoveryService } from '../../services/discovery.js'
import { BackupService } from '../../services/backup.js'
import { ConfigService } from '../../services/config.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { CcxError } from '../../types/index.js'

export interface RestoreData {
  binaryPath: string
  shortcutsStillPointToPatched: boolean
}

export interface RestoreOptions {
  discoveryService?: DiscoveryService
  backupService?: BackupService
  configService?: ConfigService
  homeDir?: string
}

export async function restoreCommand(options?: RestoreOptions): Promise<CommandResult<RestoreData>> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const backupService = options?.backupService ?? new BackupService()
  const configService = options?.configService ?? new ConfigService()

  let binaryPath: string
  try {
    binaryPath = await discovery.findClaudeBinary()
  } catch (error) {
    if (error instanceof CcxError) {
      return makeErrorResult('restore', error.code, error.message, error.suggestion)
    }
    throw error
  }

  const backupDir = configService.getBackupDir()

  try {
    await backupService.restore(binaryPath, backupDir)
  } catch (error) {
    if (error instanceof CcxError) {
      return makeErrorResult('restore', error.code, error.message, error.suggestion)
    }
    throw error
  }

  // 检测 shell 快捷方式状态
  const shortcutState = readShortcutState(options?.homeDir)

  const warnings: string[] = []
  const nextSteps: string[] = []

  if (shortcutState.pointsToPatched) {
    warnings.push(t('command.restore.shortcutsStillPoint'))
    if (shortcutState.ccTarget) {
      warnings.push(`  cc() → ${shortcutState.ccTarget}`)
    }
    if (shortcutState.cTarget) {
      warnings.push(`  c alias → ${shortcutState.cTarget}`)
    }
    nextSteps.push('Edit shell profile to point cc() to the original binary')
    nextSteps.push('Or run `claude` directly to launch the original binary')
  }

  return {
    success: true,
    command: 'restore',
    summary: t('command.restore.success'),
    data: {
      binaryPath,
      shortcutsStillPointToPatched: shortcutState.pointsToPatched,
    },
    warnings,
    next: nextSteps.length > 0 ? nextSteps : undefined,
  }
}
