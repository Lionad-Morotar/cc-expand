/**
 * ccx migration — 把已 patch 的 token 配置批量迁移到目标版本
 *
 * 读取源版本（当前 channel 优先、PATH discovery 回退、再回退 patchedAt 最新）的 combos，
 * 反解 token 对目标版本非交互式地逐个 re-patch，并切换 channel 指向新版本。
 * 与 patch 的区别：非交互、批量、仅升级场景（见 CONTEXT.md Migration 条目）。
 */
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { PatchApplier } from '../../services/patch-applier.js'
import { collectPluginContext } from '../../services/plugin-patches.js'
import { INTERNAL_PLUGINS } from '../../internal-plugins.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { ConfigService } from '../../services/config.js'
import { DiscoveryService } from '../../services/discovery.js'
import { PackageService } from '../../services/package.js'
import { queryLatestVersion } from '../../services/latest-checker.js'
import { UserConfigService } from '../../services/user-config.js'
import { maintainShellShortcuts } from '../../services/shell-maintain.js'
import { ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'
import { parseTokenCount } from '@cc-expand/plugin-context-expand'
import { extractCombos } from '../../utils/patched-combos.js'

export interface MigrationTargetResult {
  /** 源 combo（shortVer，plugin 体系权威标识） */
  combo: string
  /** 由 combo 反解的 token 数；combo 不可反解时缺省 */
  target?: number
  /** 目标环境实际生成的 binary shortVer（从 binaryPath 反推）；next 提示以此为准，避免 plugin 段不匹配 */
  producedShortVer?: string
  /** 同 token 已 execute 过，本次仅记录源 combo（展示），未重复 patch */
  skipped?: boolean
  success: boolean
  binaryPath?: string
  replaceCount?: number
  message?: string
}

export interface MigrationData {
  fromVersion: string
  toVersion: string
  /** 成功迁移的 combo（shortVer，ADR 0003 第 6 点权威 schema） */
  migratedCombos: string[]
  /** @deprecated 派生：成功 combo 反解的 token 数，向后兼容旧消费者；后续版本移除，改用 migratedCombos */
  migratedTargets: number[]
  /** 迁移失败的 combo（含不可反解的） */
  failedCombos: Array<{ combo: string, message: string }>
  /** @deprecated 派生：失败 combo 中可反解者的 token 数；不含不可反解的 combo，故 length 可能 ≠ failedCombos；后续移除 */
  failedTargets: Array<{ target: number, message: string }>
  results: MigrationTargetResult[]
  channelUpdated: boolean
  dryRun: boolean
}

export interface MigrationOptions {
  configService?: ConfigService
  packageService?: PackageService
  discoveryService?: DiscoveryService
  patchApplier?: PatchApplier
  /** 解析版本别名（如 latest）为具体 semver，注入以避免网络；失败应返回 undefined */
  resolveLatest?: (version: string) => Promise<string | undefined>
  userConfigService?: UserConfigService
  homeDir?: string
  packagesDir?: string
}

interface ParsedArgs {
  targetVersion: string
  fromVersion: string | undefined
  /** --from 后未跟值（flag 末尾或下一个是 flag） */
  fromMissingValue: boolean
  skipConfirm: boolean
  dryRun: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  let targetVersion = 'latest'
  let fromVersion: string | undefined
  let fromMissingValue = false
  let skipConfirm = false
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--from') {
      const next = args[++i]
      if (next === undefined || next.startsWith('-')) {
        fromMissingValue = true
      } else {
        // 与 target 位置参数一致：走 normalizeVersion，避免 v 前缀导致查不到记录
        fromVersion = normalizeVersion(next)
      }
    } else if (a === '--yes' || a === '-y') {
      skipConfirm = true
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (!a.startsWith('-')) {
      // 第一个非 flag 位置参数为目标版本
      targetVersion = a
    }
  }
  return { targetVersion, fromVersion, fromMissingValue, skipConfirm, dryRun }
}

interface ResolvedSource {
  version: string
  combos: string[]
}

/**
 * 从 combo 反解 token 数：取 token 段（首段）经 parseTokenCount 还原。
 * plugin 段（如 -flow）不参与——migration 只迁 token 配置，plugin 由目标环境 enabled plugins 自决。
 * 与 run 命令 resolveRunShortVer 同款语义（首段必为 token）。
 */
function parseComboToken(combo: string): number {
  return parseTokenCount(combo.split('-')[0])
}

/** 从 patched binary 路径反推 shortVer（getPatchedBinaryName 的逆操作）。
 *  next 提示用此 shortVer（目标环境实际产物），而非源 combo——plugin 段由目标环境 enabled plugins 决定，
 *  源 combo（如 27w-flow）与目标 binary（可能 claude-27w）可能不一致，用源 combo 会指向不存在的 binary。 */
function extractShortVerFromPath(binaryPath: string): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return basename(binaryPath, ext).replace(/^claude-/, '')
}

/**
 * 解析"当前版本"：channel.json.version 优先（ADR 0001，与 status/patch 对齐），
 * channel 缺失或损坏时回退 PATH discovery。任一步抛错返回 undefined。
 * Why 不直接用 PATH discovery：PATH 上常残留老版本原生 binary（如 homebrew 2.1.161），
 * 用户实际激活的是 channel 内的 patched 版本——以 PATH 为源会误选迁移源。
 */
async function resolveCurrentVersion(
  discoveryService: DiscoveryService,
  homeDir: string
): Promise<string | undefined> {
  try {
    const channel = new ChannelConfig(join(homeDir, '.cc-expand')).getChannel()
    if (channel?.version) return channel.version
  } catch {
    // channel.json 缺失或损坏：回退 PATH discovery
  }
  try {
    const binaryPath = await discoveryService.findClaudeBinary()
    const v = await discoveryService.getBinaryVersion(binaryPath)
    if (v && v !== 'unknown') return v
  } catch {
    // 无 PATH binary
  }
  return undefined
}

/**
 * 解析迁移源：--from（必须有记录）> 当前版本（channel 优先，PATH discovery 回退，若有记录）> patchedAt 最新
 * 返回 missing 表示无可用源（由调用方决定报错文案）。
 * 存在性以 combos 权威判（plugin 体系），targets 仅 legacy 回退——否则只有 combos 的新版本会被漏判，
 * 回退选中重构前遗留的老版本（真实事故：从 2.1.161 迁移而用户在用 2.1.197）。
 */
async function resolveSource(
  configService: ConfigService,
  discoveryService: DiscoveryService,
  fromVersion: string | undefined,
  homeDir: string
): Promise<ResolvedSource | { missing: true, fromVersion?: string }> {
  const patchedVersions = configService.getUserConfig().patchedVersions ?? {}

  // 1. --from 显式指定：必须存在记录，否则按"显式但无效"报错
  if (fromVersion) {
    const combos = extractCombos(patchedVersions[fromVersion])
    if (combos.length > 0) {
      return { version: fromVersion, combos }
    }
    return { missing: true, fromVersion }
  }

  // 2. 当前版本（channel 优先，PATH discovery 回退）：若该版本有 patch 记录则用作源
  const currentVersion = await resolveCurrentVersion(discoveryService, homeDir)
  if (currentVersion) {
    const combos = extractCombos(patchedVersions[currentVersion])
    if (combos.length > 0) {
      return { version: currentVersion, combos }
    }
  }

  // 3. patchedAt 最新（有非空 combos 的版本；combos 含 legacy targets 派生）
  const sorted = Object.entries(patchedVersions)
    .map(([version, info]) => ({ version, combos: extractCombos(info), patchedAt: info?.patchedAt ?? '' }))
    .filter(x => x.combos.length > 0)
    .sort((a, b) => b.patchedAt.localeCompare(a.patchedAt))
  if (sorted[0]) {
    return { version: sorted[0].version, combos: sorted[0].combos }
  }

  return { missing: true }
}

export async function migrationCommand(
  args: string[] = [],
  options?: MigrationOptions
): Promise<CommandResult<MigrationData>> {
  const parsed = parseArgs(args)

  // --from 缺值：参数错误优先报错
  if (parsed.fromMissingValue) {
    return makeErrorResult(
      'migration',
      ErrorCode.INVALID_TARGET,
      `--from requires a value`,
      `Usage: ccx migration latest --from 2.1.170`
    )
  }

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = options?.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
  const configService = options?.configService ?? new ConfigService({ homeDir })
  const discoveryService = options?.discoveryService ?? new DiscoveryService()
  const packageService = options?.packageService ?? new PackageService(packagesDir)
  const applier = options?.patchApplier ?? new PatchApplier()

  // 解析目标版本：latest 走 resolver（失败返回 undefined），否则直接用位置参数
  let toVersion = normalizeVersion(parsed.targetVersion)
  if (toVersion === 'latest') {
    const resolver = options?.resolveLatest ?? (() => queryLatestVersion())
    let resolved: string | undefined
    try {
      resolved = await resolver('latest')
    } catch {
      resolved = undefined
    }
    // resolver 失败、返回 'latest' 字面值（未解析）或非 semver → 报错，避免以 'latest' 落盘
    if (!resolved || !/^\d+\.\d+\.\d+/.test(resolved)) {
      return makeErrorResult(
        'migration',
        ErrorCode.BINARY_NOT_FOUND,
        `Failed to resolve latest version`,
        `Check your network connection, or specify a version: ccx migration 2.1.178`
      )
    }
    toVersion = resolved
  }

  // 解析源
  const source = await resolveSource(configService, discoveryService, parsed.fromVersion, homeDir)
  if ('missing' in source) {
    const msg = source.fromVersion
      ? `No patch record for version ${source.fromVersion}`
      : 'No existing patches to migrate'
    return makeErrorResult(
      'migration',
      ErrorCode.INVALID_TARGET,
      msg,
      source.fromVersion
        ? `Run 'ccx patch ${source.fromVersion}' first, or pick a version that has been patched`
        : `Run 'ccx patch' first to define your token configuration`
    )
  }
  const { version: fromVersion, combos: sourceCombos } = source

  // 目标 == 源：幂等无操作
  if (toVersion === fromVersion) {
    return {
      success: true,
      command: 'migration',
      summary: t('command.migration.alreadyAtVersion', { version: toVersion }),
      data: {
        fromVersion,
        toVersion,
        migratedCombos: [],
        migratedTargets: [],
        failedCombos: [],
        failedTargets: [],
        results: [],
        channelUpdated: false,
        dryRun: parsed.dryRun
      }
    }
  }

  // dry-run：预览将迁移的 combos（反解派生 target，与执行模式同款语义），不调 execute、不切 channel
  const dryMigratedCombos: string[] = []
  const dryMigratedTargets: number[] = []
  const dryFailedCombos: Array<{ combo: string, message: string }> = []
  for (const combo of sourceCombos) {
    try {
      dryMigratedTargets.push(parseComboToken(combo))
      dryMigratedCombos.push(combo)
    } catch {
      dryFailedCombos.push({ combo, message: `Cannot parse token from combo '${combo}'` })
    }
  }
  if (parsed.dryRun) {
    // 全部 combo 不可反解：报错（与执行模式全失败语义一致），避免自动化脚本把"无法迁移"误判为"无需迁移"
    if (dryMigratedCombos.length === 0 && sourceCombos.length > 0) {
      return makeErrorResult(
        'migration',
        ErrorCode.INVALID_TARGET,
        `Cannot parse any combo from version ${fromVersion}`,
        dryFailedCombos.map(f => `combo ${f.combo}: ${f.message}`).join('; ')
      )
    }
    return {
      success: true,
      command: 'migration',
      summary: t('command.migration.dryRun', { from: fromVersion, to: toVersion, count: sourceCombos.length }),
      data: {
        fromVersion,
        toVersion,
        migratedCombos: dryMigratedCombos,
        migratedTargets: dryMigratedTargets,
        failedCombos: dryFailedCombos,
        failedTargets: [],
        results: [],
        channelUpdated: false,
        dryRun: true
      }
    }
  }

  // 收集 plugin 上下文（与 patch 同路径），确保迁移产物 binary 命名（shortVer）与能力集（installed）一致
  const { pluginsManager, installedPatches } = await collectPluginContext({
    internalPlugins: INTERNAL_PLUGINS,
    homeDir,
    version: toVersion
  })
  // 执行迁移：prepare 一次，循环 execute 每个 target
  const applierOptions = { configService, homeDir, packagesDir, packageService, pluginsManager, installedPatches }
  const prepared = await applier.prepare(toVersion, applierOptions)
  if (!prepared.ok) {
    return makeErrorResult('migration', prepared.error.code, prepared.error.message, prepared.error.suggestion)
  }

  const results: MigrationTargetResult[] = []
  const migratedCombos: string[] = []
  const migratedTargets: number[] = []
  const failedCombos: Array<{ combo: string, message: string }> = []
  const failedTargets: Array<{ target: number, message: string }> = []
  const producedShortVers: string[] = []
  // bytecode 版本（2.1.246+）无锚点警告：多个 target 共享同一 platform 结论，只提醒一次。
  // 循环内 toVersion 是固定常量、platform 是进程常量，整个循环只有一种结论，单布尔即等价于按版本+平台去重
  const bytecodeAnchorWarnings: string[] = []
  let bytecodeAnchorWarned = false
  // 按 token 去重：同 token 的多个 combo（如 27w 与 27w-flow 都反解为 270000）只 execute 一次，
  // 避免目标 binary 互相覆盖；后续同 token combo 仍记入 migratedCombos（展示源配置），但标记 skipped
  const seenTokens = new Set<number>()
  for (const combo of sourceCombos) {
    // combo → token 反解：取 token 段（首段）经 parseTokenCount 还原。
    // plugin 段（如 -flow）不迁移——目标环境 enabled installed plugins 自决（ADR 0003 容错分级）。
    let targetTokens: number
    try {
      targetTokens = parseComboToken(combo)
    } catch {
      const message = `Cannot parse token from combo '${combo}'`
      failedCombos.push({ combo, message })
      results.push({ combo, success: false, message })
      continue
    }
    if (seenTokens.has(targetTokens)) {
      migratedCombos.push(combo)
      results.push({ combo, target: targetTokens, success: true, skipped: true })
      continue
    }
    seenTokens.add(targetTokens)
    const outcome = await applier.execute(toVersion, targetTokens, prepared.data, applierOptions)
    if (outcome.ok) {
      if (outcome.data.bytecodeAnchorMissing && !bytecodeAnchorWarned) {
        bytecodeAnchorWarned = true
        const platform = `${process.platform}-${process.arch}`
        bytecodeAnchorWarnings.push(t('warning.bytecodePatternMissing', { version: toVersion, platform }))
      }
      const producedShortVer = extractShortVerFromPath(outcome.data.binaryPath)
      migratedCombos.push(combo)
      migratedTargets.push(targetTokens)
      producedShortVers.push(producedShortVer)
      results.push({
        combo,
        target: targetTokens,
        success: true,
        producedShortVer,
        binaryPath: outcome.data.binaryPath,
        replaceCount: outcome.data.replaceCount
      })
    } else {
      failedCombos.push({ combo, message: outcome.error.message })
      failedTargets.push({ target: targetTokens, message: outcome.error.message })
      results.push({ combo, target: targetTokens, success: false, message: outcome.error.message })
    }
  }

  // 全部失败：整体失败（不切 channel）
  if (migratedCombos.length === 0) {
    return makeErrorResult(
      'migration',
      ErrorCode.PATCH_FAILED,
      `Failed to migrate any combo to ${toVersion}`,
      failedCombos.map(f => `combo ${f.combo}: ${f.message}`).join('; ')
    )
  }

  // shell 维护：用首个成功 combo 反解的 token 作默认（shell alias 只能指向单个 target，属固有限制）
  const userConfigService = options?.userConfigService ?? new UserConfigService()
  const warnings: string[] = [...bytecodeAnchorWarnings]
  if (userConfigService.get('autoMaintain') && migratedTargets[0] !== undefined) {
    const summary = await maintainShellShortcuts({
      targetTokens: migratedTargets[0],
      skipConfirm: parsed.skipConfirm,
      homeDir
    })
    if (summary) warnings.push(summary)
  }

  // 切换 channel 指向新版本（与 setup.ts 写入格式一致：path 含版本目录）
  new ChannelConfig(join(homeDir, '.cc-expand')).saveChannel({
    channel: 'local',
    path: join(packagesDir, toVersion),
    version: toVersion
  })

  if (failedCombos.length > 0) {
    warnings.push(`${failedCombos.length} combo(s) failed: ${failedCombos.map(f => f.combo).join(', ')}`)
  }

  return {
    success: true,
    command: 'migration',
    summary: t('command.migration.success', { from: fromVersion, to: toVersion, count: migratedCombos.length }),
    data: {
      fromVersion,
      toVersion,
      migratedCombos,
      migratedTargets,
      failedCombos,
      failedTargets,
      results,
      channelUpdated: true,
      dryRun: false
    },
    // next 用目标环境实际生成的 shortVer（去重），避免源 combo 的 plugin 段与目标 binary 名不符
    next: [...new Set(producedShortVers)].map(sv => `ccx run ${sv}`),
    warnings: warnings.length > 0 ? warnings : undefined
  }
}
