/**
 * ccx migration — 把已 patch 的 token 配置批量迁移到目标版本
 *
 * 读取源版本（当前 channel/discovery 版本，回退 patchedAt 最新）的 targets，
 * 对目标版本非交互式地逐个 re-patch，并切换 channel 指向新版本。
 * 与 patch 的区别：非交互、批量、仅升级场景（见 CONTEXT.md Migration 条目）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PatchApplier } from '../../services/patch-applier.js'
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

export interface MigrationTargetResult {
  target: number
  success: boolean
  binaryPath?: string
  replaceCount?: number
  message?: string
}

export interface MigrationData {
  fromVersion: string
  toVersion: string
  migratedTargets: number[]
  failedTargets: Array<{ target: number; message: string }>
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
  targets: number[]
}

/**
 * 解析迁移源：--from（必须有记录）> discovery 当前版本（若有记录）> patchedAt 最新（有记录）
 * 返回 missing 表示无可用源（由调用方决定报错文案）
 */
async function resolveSource(
  configService: ConfigService,
  discoveryService: DiscoveryService,
  fromVersion: string | undefined,
): Promise<ResolvedSource | { missing: true; fromVersion?: string }> {
  const patchedVersions = configService.getUserConfig().patchedVersions ?? {}

  // 1. --from 显式指定：必须存在记录，否则按"显式但无效"报错
  if (fromVersion) {
    const info = patchedVersions[fromVersion]
    if (info && info.targets.length > 0) {
      return { version: fromVersion, targets: info.targets }
    }
    return { missing: true, fromVersion }
  }

  // 2. discovery 当前版本（若该版本有 patch 记录）
  try {
    const binaryPath = await discoveryService.findClaudeBinary()
    const v = await discoveryService.getBinaryVersion(binaryPath)
    if (v && v !== 'unknown') {
      const info = patchedVersions[v]
      if (info && info.targets.length > 0) {
        return { version: v, targets: info.targets }
      }
    }
  } catch {
    // 无当前 binary，继续回退
  }

  // 3. patchedAt 最新（有非空 targets 的版本）
  const sorted = Object.entries(patchedVersions)
    .filter(([, info]) => info && info.targets.length > 0)
    .sort((a, b) => (b[1].patchedAt ?? '').localeCompare(a[1].patchedAt ?? ''))
  if (sorted[0]) {
    return { version: sorted[0][0], targets: sorted[0][1].targets }
  }

  return { missing: true }
}

export async function migrationCommand(
  args: string[] = [],
  options?: MigrationOptions,
): Promise<CommandResult<MigrationData>> {
  const parsed = parseArgs(args)

  // --from 缺值：参数错误优先报错
  if (parsed.fromMissingValue) {
    return makeErrorResult(
      'migration',
      ErrorCode.INVALID_TARGET,
      `--from requires a value`,
      `Usage: ccx migration latest --from 2.1.170`,
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
        `Check your network connection, or specify a version: ccx migration 2.1.178`,
      )
    }
    toVersion = resolved
  }

  // 解析源
  const source = await resolveSource(configService, discoveryService, parsed.fromVersion)
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
        : `Run 'ccx patch' first to define your token configuration`,
    )
  }
  const { version: fromVersion, targets: sourceTargets } = source

  // 目标 == 源：幂等无操作
  if (toVersion === fromVersion) {
    return {
      success: true,
      command: 'migration',
      summary: t('command.migration.alreadyAtVersion', { version: toVersion }),
      data: {
        fromVersion,
        toVersion,
        migratedTargets: [],
        failedTargets: [],
        results: [],
        channelUpdated: false,
        dryRun: parsed.dryRun,
      },
    }
  }

  // dry-run：只预览将迁移的 targets，不执行、不切 channel
  if (parsed.dryRun) {
    return {
      success: true,
      command: 'migration',
      summary: t('command.migration.dryRun', { from: fromVersion, to: toVersion, count: sourceTargets.length }),
      data: {
        fromVersion,
        toVersion,
        migratedTargets: [...sourceTargets],
        failedTargets: [],
        results: [],
        channelUpdated: false,
        dryRun: true,
      },
    }
  }

  // 执行迁移：prepare 一次，循环 execute 每个 target
  const applierOptions = { configService, homeDir, packagesDir, packageService }
  const prepared = await applier.prepare(toVersion, applierOptions)
  if (!prepared.ok) {
    return makeErrorResult('migration', prepared.error.code, prepared.error.message, prepared.error.suggestion)
  }

  const results: MigrationTargetResult[] = []
  const migratedTargets: number[] = []
  const failedTargets: Array<{ target: number; message: string }> = []
  for (const target of sourceTargets) {
    const outcome = await applier.execute(toVersion, target, prepared.data, applierOptions)
    if (outcome.ok) {
      migratedTargets.push(target)
      results.push({
        target,
        success: true,
        binaryPath: outcome.data.binaryPath,
        replaceCount: outcome.data.replaceCount,
      })
    } else {
      failedTargets.push({ target, message: outcome.error.message })
      results.push({ target, success: false, message: outcome.error.message })
    }
  }

  // 全部失败：整体失败（不切 channel）
  if (migratedTargets.length === 0) {
    return makeErrorResult(
      'migration',
      ErrorCode.PATCH_FAILED,
      `Failed to migrate any target to ${toVersion}`,
      failedTargets.map((f) => `target ${f.target}: ${f.message}`).join('; '),
    )
  }

  // shell 维护：用首个成功 target 作为默认（shell alias 只能指向单个 target，属固有限制）
  const userConfigService = options?.userConfigService ?? new UserConfigService()
  const warnings: string[] = []
  if (userConfigService.get('autoMaintain') && migratedTargets[0] !== undefined) {
    const summary = await maintainShellShortcuts({
      targetTokens: migratedTargets[0],
      skipConfirm: parsed.skipConfirm,
      homeDir,
    })
    if (summary) warnings.push(summary)
  }

  // 切换 channel 指向新版本（与 setup.ts 写入格式一致：path 含版本目录）
  new ChannelConfig(join(homeDir, '.cc-expand')).saveChannel({
    channel: 'local',
    path: join(packagesDir, toVersion),
    version: toVersion,
  })

  if (failedTargets.length > 0) {
    warnings.push(`${failedTargets.length} target(s) failed: ${failedTargets.map((f) => f.target).join(', ')}`)
  }

  return {
    success: true,
    command: 'migration',
    summary: t('command.migration.success', { from: fromVersion, to: toVersion, count: migratedTargets.length }),
    data: {
      fromVersion,
      toVersion,
      migratedTargets,
      failedTargets,
      results,
      channelUpdated: true,
      dryRun: false,
    },
    // 列出全部成功 target 的 run 提示（多 target 场景每个都可启动）
    next: migratedTargets.map((tg) => `ccx run ${tg}`),
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}
