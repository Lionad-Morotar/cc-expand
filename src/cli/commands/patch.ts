/**
 * cc-expand patch — 交互式 patch 命令
 * 从本地包复制 binary → patch → 保存到 ~/.cc-expand/bin/
 *
 * 核心流程委托给 PatchApplier（prepare + execute），本文件只负责参数解析、
 * 交互式提示、确认与 shell 快捷方式维护。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PatchApplier } from '../../services/patch-applier.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { ConfigService } from '../../services/config.js'
import { UserConfigService } from '../../services/user-config.js'
import { maintainShellShortcuts } from '../../services/shell-maintain.js'
import { CcxError, ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'
import { parseTokenCount } from '../../utils/parse-token-count.js'

/** re-export：getPatchedBinaryName 现归属 PatchApplier，此处转发以保持向后兼容（patch-binary-name.test.ts） */
export { getPatchedBinaryName } from '../../services/patch-applier.js'

export interface PatchData {
  version: string
  targetTokens: number
  sourceValue: string
  replaceCount: number
  binaryPath: string
  details: Array<{ desc: string; offset: number }>
  shortcutsUpdated: boolean
  /** shell 快捷方式维护结果摘要（autoMaintain 关闭时为 undefined） */
  maintainSummary?: string
}

export interface PatchOptions {
  configService?: ConfigService
  userConfigService?: UserConfigService
  homeDir?: string
  packagesDir?: string
}

export async function patchCommand(
  args: string[] = [],
  options?: PatchOptions,
): Promise<CommandResult<PatchData>> {
  const configService = options?.configService ?? new ConfigService()
  const userConfigService = options?.userConfigService ?? new UserConfigService()

  // 解析命令行参数
  let targetTokens: number | undefined
  let skipConfirm = false
  let version: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      const next = args[i + 1]
      if (next === undefined) {
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          `--target requires a value`,
          `Usage: ccx patch --target 256000`,
        )
      }
      try {
        targetTokens = parseTokenCount(next)
      } catch (error) {
        const message = error instanceof CcxError ? error.message : String(error)
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          message,
          `Usage: ccx patch --target 256000`,
        )
      }
      i++
    } else if (args[i] === '--yes' || args[i] === '-y') {
      skipConfirm = true
    } else if (!args[i].startsWith('-') && version === undefined) {
      // 位置参数：Claude Code 版本。必须在消费完 flag 值后识别，
      // 否则 ccx patch --target 500000 2.1.170 里的 500000 会被误判为版本
      version = normalizeVersion(args[i])
    }
  }

  // --yes 必须配合 --target 使用
  if (skipConfirm && targetTokens === undefined) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      '--yes requires --target',
      'Usage: ccx patch --target 256000 --yes',
    )
  }

  // 验证 target tokens 有效（提前拒绝，避免不必要的 I/O）
  if (targetTokens !== undefined && targetTokens <= 0) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${targetTokens}`,
      `Target must be a positive integer (e.g. 256000)`,
    )
  }

  // 确定版本：命令行 > channel.json > 报错
  if (!version) {
    const homeDir = options?.homeDir ?? homedir()
    const configDir = join(homeDir, '.cc-expand')
    const channelConfig = new ChannelConfig(configDir)
    const channel = channelConfig.getChannel()
    version = channel?.version
  }

  if (!version) {
    return makeErrorResult(
      'patch',
      ErrorCode.BINARY_NOT_FOUND,
      'No version specified',
      'Provide a version (e.g. ccx patch 2.1.170) or run setup first to select a version',
    )
  }

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = options?.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
  const applierOptions = { configService, homeDir, packagesDir }
  const applier = new PatchApplier()

  // 阶段一：install 包 + 获取 pattern（拿到 sourceValue 供交互提示）
  const prepared = await applier.prepare(version, applierOptions)
  if (!prepared.ok) {
    return makeErrorResult('patch', prepared.error.code, prepared.error.message, prepared.error.suggestion)
  }
  const { patches, sourceValue } = prepared.data

  if (targetTokens === undefined) {
    // 交互式模式
    const { input } = await import('@inquirer/prompts')
    const targetInput = await input({
      message: `Current context window: ${sourceValue}\nEnter target tokens (e.g. 256000 or 270k):`,
      validate: (value: string) => {
        try {
          const parsed = parseTokenCount(value)
          if (String(parsed).length !== sourceValue.length) {
            return `Must be ${sourceValue.length} digits`
          }
          return true
        } catch (e) {
          return e instanceof CcxError ? e.message : 'Please enter a valid number'
        }
      },
    })
    targetTokens = parseTokenCount(targetInput)
  }

  // 确认
  if (!skipConfirm) {
    const { confirm } = await import('@inquirer/prompts')
    const confirmed = await confirm({
      message: `Replace ${patches.length} constant(s) from ${sourceValue} to ${targetTokens}?`,
    })

    if (!confirmed) {
      return {
        success: true,
        command: 'patch',
        summary: 'Patch cancelled',
        data: {
          version,
          targetTokens,
          sourceValue,
          replaceCount: 0,
          binaryPath: '',
          details: [],
          shortcutsUpdated: false,
        },
      }
    }
  }

  // 阶段二：执行 patch（copy → replace → codesign → verify → record）
  const outcome = await applier.execute(version, targetTokens, prepared.data, applierOptions)
  if (!outcome.ok) {
    return makeErrorResult('patch', outcome.error.code, outcome.error.message, outcome.error.suggestion)
  }
  const applied = outcome.data

  // 自动维护 shell 快捷方式（可由用户配置关闭）
  let maintainSummary = ''
  const autoMaintain = userConfigService.get('autoMaintain')
  if (autoMaintain) {
    maintainSummary = await maintainShellShortcuts({
      targetTokens: applied.targetTokens,
      skipConfirm,
      homeDir,
    })
  }

  return {
    success: true,
    command: 'patch',
    summary: t('command.patch.success', { version: applied.version, targetTokens: applied.targetTokens }),
    data: {
      version: applied.version,
      targetTokens: applied.targetTokens,
      sourceValue: applied.sourceValue,
      replaceCount: applied.replaceCount,
      binaryPath: applied.binaryPath,
      details: applied.details,
      shortcutsUpdated: !!autoMaintain,
      maintainSummary: maintainSummary || undefined,
    },
    next: [
      `ccx run ${applied.targetTokens}`,
      `cc ${applied.targetTokens}`,
    ],
    warnings: applied.codesignWarning ? [applied.codesignWarning] : undefined,
  }
}
