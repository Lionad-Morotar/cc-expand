/**
 * ccx patch remove —— 移除某版本下已应用的 plugin combo
 *
 * 与 `ccx plugins remove` 区分：后者管理 plugin 注册表，本命令管理已 patch 的记录与 binary。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ConfigService } from '../../services/config.js'
import { PatchCleanupService } from '../../services/patch-cleanup.js'
import { formatTokenCount } from '@cc-expand/plugin-context-expand'
import { parseTokenCount } from '../../utils/parse-token-count.js'
import { ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'

export interface PatchRemoveData {
  version: string
  removedCombos: string[]
  warnings: string[]
}

export interface PatchRemoveOptions {
  configService?: ConfigService
  patchCleanupService?: PatchCleanupService
  homeDir?: string
}

/**
 * 把用户输入的 combo 规范化成 versions.json 中记录的 canonical 形式。
 * 支持 `270000`、`27w`、`270k` 及含 plugin 段的 `27w-flow`；非 token 段原样保留。
 * 完全无法解析时（如纯 plugin literal combo）返回原值，避免误规范化。
 */
function normalizeComboInput(input: string): string {
  const parts = input.split('-')
  try {
    parts[0] = formatTokenCount(parseTokenCount(parts[0]))
    return parts.join('-')
  } catch {
    return input
  }
}

export async function patchRemoveCommand(
  args: string[],
  options?: PatchRemoveOptions
): Promise<CommandResult<PatchRemoveData>> {
  const version = args[0]
  const combo = args[1]

  if (!version) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      'Remove requires a version',
      'Usage: ccx patch remove <version> [combo]'
    )
  }

  const homeDir = options?.homeDir ?? homedir()
  const configService = options?.configService ?? new ConfigService({ homeDir })
  const cleanupService = options?.patchCleanupService ?? new PatchCleanupService({ homeDir })

  const removedCombos: string[] = []
  const warnings: string[] = []

  if (combo) {
    const canonicalCombo = normalizeComboInput(combo)
    const removed = configService.removePatchedCombo(version, canonicalCombo)
    if (!removed) {
      return makeErrorResult(
        'patch',
        ErrorCode.PATTERN_NOT_FOUND,
        `Combo '${combo}' not found for version ${version}`,
        `Run 'ccx list' to see available combos`
      )
    }
    removedCombos.push(canonicalCombo)
    const cleanup = cleanupService.remove(canonicalCombo)
    if (cleanup.warning) warnings.push(cleanup.warning)
  } else {
    const userConfig = configService.getUserConfig()
    const info = userConfig.patchedVersions?.[version]
    const combos = info?.combos ?? []
    // 兼容 legacy targets：把 targets 转成 combos 一并清理记录；binary 名可能是旧命名（raw target）或新命名（shortVer）
    const legacyTargets = info?.targets ?? []
    const legacyCombos = legacyTargets.map(formatTokenCount)
    const allCombos = Array.from(new Set([...combos, ...legacyCombos]))
    if (allCombos.length === 0) {
      return makeErrorResult(
        'patch',
        ErrorCode.PATTERN_NOT_FOUND,
        `No patch records found for version ${version}`,
        `Run 'ccx list' to see available versions`
      )
    }
    const removed = configService.removePatchedVersion(version)
    if (removed) {
      removedCombos.push(...allCombos)
    }
    // 删除 plugin  era 的 binary（combo 命名）以及旧 era 的 binary（raw target 命名）
    const binariesToDelete = Array.from(new Set([...allCombos, ...legacyTargets.map(String)]))
    for (const c of binariesToDelete) {
      const cleanup = cleanupService.remove(c)
      if (cleanup.warning) warnings.push(cleanup.warning)
    }
  }

  const summary = removedCombos.length === 1
    ? t('command.patch.remove.success', { version, combo: removedCombos[0] })
    : t('command.patch.remove.all', { version, count: removedCombos.length })

  return {
    success: true,
    command: 'patch',
    summary,
    data: { version, removedCombos, warnings },
    warnings: warnings.length > 0 ? warnings : undefined,
    next: [`ccx list`]
  }
}
