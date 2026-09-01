/**
 * cc-expand patch — 交互式 patch 命令
 * 从本地包复制 binary → patch → 保存到 ~/.cc-expand/bin/
 *
 * 核心流程委托给 PatchApplier（prepare + execute），本文件只负责参数解析、
 * 交互式提示、确认与 shell 快捷方式维护。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PatchApplier, type AppliedPatch } from '../../services/patch-applier.js'
import { collectPluginContext } from '../../services/plugin-patches.js'
import { INTERNAL_PLUGINS } from '../../internal-plugins.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { ConfigService } from '../../services/config.js'
import { UserConfigService } from '../../services/user-config.js'
import { maintainShellShortcuts } from '../../services/shell-maintain.js'
import { ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'
import { parseTokenCount } from '../../utils/parse-token-count.js'
import { extractCombos } from '../../utils/patched-combos.js'
import { validateTargetInput } from '../../utils/validate-target.js'
import { patchRemoveCommand } from './patch-remove.js'

/** re-export：getPatchedBinaryName 现归属 PatchApplier，此处转发以保持向后兼容（patch-binary-name.test.ts） */
export { getPatchedBinaryName } from '../../services/patch-applier.js'

/**
 * 组装 patch 成功的 warnings（无警告时返回 undefined）。
 * bytecode 版本无锚点：patch 报告成功但运行时上下文窗口不变，属警告而非失败（复用 warnings 先例）。
 */
function buildPatchWarnings(applied: AppliedPatch): string[] | undefined {
  const warnings: string[] = []
  if (applied.codesignWarning) warnings.push(applied.codesignWarning)
  if (applied.bytecodeAnchorMissing) {
    warnings.push(t('warning.bytecodePatternMissing', {
      version: applied.version,
      platform: `${process.platform}-${process.arch}`
    }))
  }
  return warnings.length > 0 ? warnings : undefined
}

export interface PatchData {
  version: string
  targetTokens: number
  sourceValue: string
  replaceCount: number
  /** bytecode 常量池锚点替换次数（无锚点配置时为 0）；JSON 消费者据此判断字节码补丁是否命中 */
  bytecodeReplaceCount?: number
  /** bytecode 版本（2.1.246+）但当前 platform 无锚点配置：文本替换成功但运行时上下文窗口不变 */
  bytecodeAnchorMissing?: boolean
  binaryPath: string
  details: Array<{ desc?: string, offset: number }>
  shortcutsUpdated: boolean
  /** shell 快捷方式维护结果摘要（autoMaintain 关闭时为 undefined） */
  maintainSummary?: string
}

export interface PatchOptions {
  configService?: ConfigService
  userConfigService?: UserConfigService
  patchCleanupService?: import('../../services/patch-cleanup.js').PatchCleanupService
  homeDir?: string
  packagesDir?: string
}

/**
 * 为 "--yes requires --target" 错误构造 suggestion：列出当前激活版本的可用 combo。
 * 读不到（无 channel / 无记录 / stub config）则退回固定用法提示，绝不抛错阻塞错误路径。
 * Why：-y 非交互要求显式 --target（patch 改 binary 是破坏性操作），但固定文案无指引；
 * 列出已 patch 的 combo 让用户一步复制，体验提升且零隐式行为风险。
 */
function buildYesHint(configService: ConfigService, homeDir: string): string {
  const base = 'Usage: ccx patch --target 256000 --yes'
  try {
    const channel = new ChannelConfig(join(homeDir, '.cc-expand')).getChannel()
    const version = channel?.version
    if (!version) return base
    const info = configService.getUserConfig().patchedVersions?.[version]
    const combos = extractCombos(info)
    if (combos.length === 0) {
      return `Version ${version} has no patch record yet. Run 'ccx patch ${version} --target <tokens>' first, or specify --target here (e.g. ccx patch --target 256000 --yes)`
    }
    return `Available combos for ${version}: ${combos.join(', ')}. Example: ccx patch --target ${combos[0]} --yes`
  } catch {
    return base
  }
}

export async function patchCommand(
  args: string[] = [],
  options?: PatchOptions
): Promise<CommandResult> {
  // ccx patch remove <version> [combo] 子命令
  if (args[0] === 'remove') {
    return patchRemoveCommand(args.slice(1), options)
  }

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
          `Usage: ccx patch --target 256000`
        )
      }
      try {
        targetTokens = parseTokenCount(next)
      } catch (error) {
        const message = (error as Error).message
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          message,
          `Usage: ccx patch --target 256000`
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

  // --yes 必须配合 --target：patch 改 binary 是破坏性操作，非交互必须显式 target。
  // suggestion 增强列出当前激活版本可用 combo，指引用户下一步。
  if (skipConfirm && targetTokens === undefined) {
    const homeDir = options?.homeDir ?? homedir()
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      '--yes requires --target',
      buildYesHint(configService, homeDir)
    )
  }

  // 验证 target tokens 有效（提前拒绝，避免不必要的 I/O）
  if (targetTokens !== undefined && targetTokens <= 0) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${targetTokens}`,
      `Target must be a positive integer (e.g. 256000)`
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
      'Provide a version (e.g. ccx patch 2.1.170) or run setup first to select a version'
    )
  }

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = options?.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
  // 收集 plugin 上下文（PluginsManager + enabled installed shards），patch 与 migration 共用此 helper（C9 一致性）
  const { pluginsManager, installedPatches } = await collectPluginContext({
    internalPlugins: INTERNAL_PLUGINS,
    homeDir,
    version
  })
  const applierOptions = { configService, homeDir, packagesDir, pluginsManager, installedPatches }
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
      validate: (value: string) => validateTargetInput(value, sourceValue)
    })
    targetTokens = parseTokenCount(targetInput)
  }

  // 确认
  if (!skipConfirm) {
    const { confirm } = await import('@inquirer/prompts')
    const confirmed = await confirm({
      message: `Replace ${patches.length} constant(s) from ${sourceValue} to ${targetTokens}?`
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
          shortcutsUpdated: false
        }
      }
    }
  }

  // 阶段二：执行 patch（copy → replace → codesign → verify → record）
  const outcome = await applier.execute(version, targetTokens, prepared.data, applierOptions)
  if (!outcome.ok) {
    return makeErrorResult('patch', outcome.error.code, outcome.error.message, outcome.error.suggestion)
  }
  const applied = outcome.data

  // patch 成功后把该版本记为 active channel，使 shell 快捷方式的版本校验以此为基准，
  // 避免 patch 了新版本后旧 channel.json 仍指向上一版本导致启动失败。
  const configDir = join(homeDir, '.cc-expand')
  new ChannelConfig(configDir).saveChannel({
    channel: 'local',
    path: join(configDir, 'packages', applied.version),
    version: applied.version
  })

  // 自动维护 shell 快捷方式（可由用户配置关闭）
  let maintainSummary = ''
  const autoMaintain = userConfigService.get('autoMaintain')
  if (autoMaintain) {
    maintainSummary = await maintainShellShortcuts({
      targetTokens: applied.targetTokens,
      skipConfirm,
      homeDir
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
      bytecodeReplaceCount: applied.bytecodeReplaceCount,
      ...(applied.bytecodeAnchorMissing ? { bytecodeAnchorMissing: applied.bytecodeAnchorMissing } : {}),
      binaryPath: applied.binaryPath,
      details: applied.details,
      shortcutsUpdated: !!autoMaintain,
      maintainSummary: maintainSummary || undefined
    },
    next: [
      `ccx run ${applied.targetTokens}`,
      `cc ${applied.targetTokens}`
    ],
    warnings: buildPatchWarnings(applied)
  }
}
