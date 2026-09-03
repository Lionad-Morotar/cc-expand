/**
 * self-update command — 更新 cc-expand 自身到最新 npm 版本
 *
 * 编排 InstallMethodDetector + UpdateCheckService + spawner。
 * 手动执行时强制查最新版（skipCache）：已是最新则跳过 spawn，有更新则显示 from→to，
 * 查询失败则降级直接 spawn（用户意图明确，不因版本查询失败而阻止）。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InstallMethod } from '../../types/index.js'
import { ErrorCode } from '../../types/index.js'
import { InstallMethodDetector } from '../../services/install-method.js'
import { UpdateCheckService } from '../../services/update-check.js'
import { isVersionGreater } from '../../utils/version.js'
import { getReleaseChannel } from '../../utils/release-channel.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { t } from '../i18n.js'

export interface SpawnResult {
  code: number | null
}

export type Spawner = (cmd: string, args: readonly string[]) => Promise<SpawnResult>

export interface SelfUpdateOptions {
  installMethodDetector?: InstallMethodDetector
  spawner?: Spawner
  /** 更新检查服务（注入用），默认新建 */
  updateCheckService?: Pick<UpdateCheckService, 'check'>
  /** 当前版本（注入用），默认从 package.json 读取 */
  currentVersion?: string
  /** 安装后版本验证器（注入用），默认 readCurrentVersion 重读 package.json 实际版本 */
  versionVerifier?: () => string
  /** 显式更新目标（npm dist-tag 或精确版本，如 latest / alpha / 0.5.1）。
   *  传入时跳过"是否有更新"判定直接安装 cc-expand@<targetChannel>——
   *  解决 dist-tag 停更（如 alpha tag 未随 stable 发布推进）把通道用户困死的问题。 */
  targetChannel?: string
}

/** 各安装方式 + channel 的更新命令。channel = npm dist-tag（latest/alpha/beta/...），
 *  使 prerelease 用户装 @<channel> 而非 @latest，避免被降级到 stable（丢失 alpha 特性）。 */
function getUpdateCommand(
  method: Exclude<InstallMethod, 'npx' | 'unknown'>,
  channel: string
): readonly [string, readonly string[]] {
  const spec = `cc-expand@${channel}`
  switch (method) {
    case 'npm': return ['npm', ['install', '-g', spec]]
    case 'pnpm': return ['pnpm', ['add', '-g', spec]]
    case 'yarn': return ['yarn', ['global', 'add', channel === 'latest' ? 'cc-expand' : spec]]
  }
}

/** 从 package.json 读取当前 cc-expand 版本 */
function readCurrentVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    return (JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 显式目标合法性：npm dist-tag 或精确版本共用的安全字符集（拒路径分隔符、空白与 shell 元字符） */
const TARGET_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * 执行安装命令并统一处理非零退出码与 spawn 异常（显式目标与常规路径共用，防失败行为漂移）。
 * 成功时返回 null，由调用方继续版本验证与回显。
 */
async function runInstaller(cmd: string, args: readonly string[], spawner: Spawner): Promise<CommandResult | null> {
  try {
    const result = await spawner(cmd, args)
    if (result.code !== 0) {
      return makeErrorResult(
        'self-update',
        ErrorCode.SELF_UPDATE_FAILED,
        t('error.selfUpdate.exitCode', { code: result.code ?? 'killed' })
      )
    }
    return null
  } catch (error) {
    return handleSpawnError(error)
  }
}

/**
 * 安装显式目标（dist-tag 或精确版本）。
 *
 * 不查 registry、不判 hasUpdate——用户点名目标即安装，装后读回真实版本回显；
 * 版本未变（已处于该版本）时如实提示而非冒充更新成功。
 */
async function installExplicitTarget(
  target: string,
  method: Exclude<InstallMethod, 'npx' | 'unknown'>,
  options: SelfUpdateOptions
): Promise<CommandResult> {
  if (!TARGET_PATTERN.test(target)) {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.invalidTarget', { value: target }),
      t('suggestion.selfUpdate.invalidTarget')
    )
  }

  const from = options.currentVersion ?? readCurrentVersion()
  const [cmd, args] = getUpdateCommand(method, target)
  const spawner = options.spawner ?? createDefaultSpawner()

  const failure = await runInstaller(cmd, args, spawner)
  if (failure) return failure

  const to = options.versionVerifier?.() ?? readCurrentVersion()
  if (to === from) {
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.explicitUnchanged', { version: to, target })
    }
  }
  return {
    success: true,
    command: 'self-update',
    summary: t('command.selfUpdate.updated', { from, to })
  }
}

export async function selfUpdateCommand(options?: SelfUpdateOptions): Promise<CommandResult> {
  const detector = options?.installMethodDetector ?? new InstallMethodDetector()
  const method = await detector.detect()

  // npx 特判：每次自动拉最新，无需 self-update
  if (method === 'npx') {
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.npxHint')
    }
  }

  // unknown：无法自动决定，引导用户配置
  if (method === 'unknown') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.unknownMethod'),
      t('suggestion.selfUpdate.unknownMethod')
    )
  }

  // 显式目标：用户意图明确，跳过更新检查（hasUpdate 判定对停更 dist-tag 无意义），直接安装。
  // 用 !== undefined 而非 truthy：空字符串也是"用户传了目标"，应走校验报错而非静默落回常规路径
  if (options?.targetChannel !== undefined) {
    return installExplicitTarget(options.targetChannel, method, options)
  }

  // 强制查最新版（skipCache：手动执行不读缓存，拉真实 registry）
  const currentVersion = options?.currentVersion ?? readCurrentVersion()
  const channel = getReleaseChannel(currentVersion)
  const updateCheck = options?.updateCheckService ?? new UpdateCheckService({ currentVersion })
  const info = await updateCheck.check({ skipCache: true })

  // 已是最新 → 跳过 spawn
  if (info && !info.hasUpdate) {
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.alreadyLatest', { version: currentVersion })
    }
  }

  // 查询失败（info=null）+ prerelease 通道：无法确定该通道最新版，提示手动更新而非 spawn——
  // 否则 getUpdateCommand 会装 @latest 把 alpha 用户降级到 stable，丢失 alpha 特性。
  // stable 通道查询失败仍 spawn（查询失败不阻止明确的用户意图）。
  if (!info && channel !== 'latest') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.prereleaseChannelUnknown', { channel }),
      t('suggestion.selfUpdate.prereleaseChannelUnknown', { channel })
    )
  }

  const [cmd, args] = getUpdateCommand(method, channel)
  const spawner = options?.spawner ?? createDefaultSpawner()

  const failure = await runInstaller(cmd, args, spawner)
  if (failure) return failure

  // 验证：重新读实际安装版本，确认更新真正生效。
  // 防止镜像同步延迟等导致"npm 装了旧版、退出码 0、却谎报已更新到 latest"。
  if (info) {
    const actualVersion = options?.versionVerifier?.() ?? readCurrentVersion()
    if (isVersionGreater(info.latestVersion, actualVersion)) {
      // spawn 成功但实际版本仍落后 → 告警而非撒谎，提示用官方源重试
      return {
        success: true,
        command: 'self-update',
        severity: 'warning',
        summary: t('command.selfUpdate.stalledSummary', { actual: actualVersion }),
        warnings: [
          t('warning.selfUpdate.stalled', {
            actual: actualVersion,
            latest: info.latestVersion
          }),
          t('warning.selfUpdate.registryHint')
        ]
      }
    }
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.updated', {
        from: info.currentVersion,
        to: info.latestVersion
      })
    }
  }

  // info=null（版本查询失败）→ 无法验证，直接报成功
  return {
    success: true,
    command: 'self-update',
    summary: t('command.selfUpdate.success')
  }
}

/** 默认 spawner：用 spawn + stdio inherit，让包管理器原生输出直通终端 */
function createDefaultSpawner(): Spawner {
  return (cmd: string, args: readonly string[]) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'inherit' })
      child.on('close', code => resolve({ code }))
      child.on('error', reject)
    })
}

/** 分类 spawn 错误，给出可操作建议 */
function handleSpawnError(error: unknown): CommandResult {
  const err = error as NodeJS.ErrnoException
  if (err.code === 'EACCES') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.eacces'),
      t('suggestion.selfUpdate.eacces')
    )
  }
  if (err.code === 'ENOENT') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.enoent', { message: err.message }),
      t('suggestion.selfUpdate.enoent')
    )
  }
  return makeErrorResult(
    'self-update',
    ErrorCode.SELF_UPDATE_FAILED,
    t('error.selfUpdate.generic', { message: err.message ?? String(error) })
  )
}
