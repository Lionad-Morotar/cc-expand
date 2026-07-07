/**
 * cc-expand restore — 回滚到原始二进制
 */
import { DiscoveryService } from '../../services/discovery.js'
import { BackupService } from '../../services/backup.js'
import { ConfigService } from '../../services/config.js'
import { UserConfigService } from '../../services/user-config.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { maintainShellShortcutsToOriginal, type MaintainToOriginalOptions } from '../../services/shell-maintain.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { CcxError } from '../../types/index.js'

export interface RestoreData {
  binaryPath: string
  shortcutsStillPointToPatched: boolean
  shortcutsUpdated: boolean
  /** shell 快捷方式维护结果摘要（autoMaintain 关闭时为 undefined） */
  maintainSummary?: string
}

export interface RestoreOptions {
  discoveryService?: DiscoveryService
  backupService?: BackupService
  configService?: ConfigService
  userConfigService?: UserConfigService
  homeDir?: string
  /** 注入 maintain 函数（测试用），默认 maintainShellShortcutsToOriginal */
  maintain?: (options: MaintainToOriginalOptions) => Promise<string>
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

  let shortcutsUpdated = false
  let maintainSummary: string | undefined
  const warnings: string[] = []
  const nextSteps: string[] = []

  if (shortcutState.pointsToPatched) {
    const userConfigService = options?.userConfigService ?? new UserConfigService()
    const autoMaintain = userConfigService.get('autoMaintain')
    const doMaintain = options?.maintain ?? maintainShellShortcutsToOriginal

    if (autoMaintain) {
      // 覆盖更新：把 cc-expand 块改为调用原版 Claude Code
      // autoMaintain 已表达"自动维护"，skipConfirm 直接覆盖
      maintainSummary = await doMaintain({
        skipConfirm: true,
        homeDir: options?.homeDir
      })
      shortcutsUpdated = true
    } else {
      // autoMaintain 关闭：退回警告行为，提示用户手动处理或开启自动维护
      warnings.push(t('command.restore.shortcutsStillPoint'))
      if (shortcutState.ccTarget) {
        warnings.push(`  cc() → ${shortcutState.ccTarget}`)
      }
      if (shortcutState.cTarget) {
        warnings.push(`  c alias → ${shortcutState.cTarget}`)
      }
      nextSteps.push('Run `ccx config set autoMaintain true` then `ccx restore` to update shortcuts automatically')
      nextSteps.push('Or edit shell profile manually to point cc() to the original binary')
    }
  }

  return {
    success: true,
    command: 'restore',
    summary: t('command.restore.success'),
    data: {
      binaryPath,
      shortcutsStillPointToPatched: !shortcutsUpdated && shortcutState.pointsToPatched,
      shortcutsUpdated,
      maintainSummary
    },
    warnings: warnings.length > 0 ? warnings : undefined,
    next: nextSteps.length > 0 ? nextSteps : undefined
  }
}
