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
}

/** 各安装方式对应的更新命令 */
const UPDATE_COMMANDS: Record<
  Exclude<InstallMethod, 'npx' | 'unknown'>,
  readonly [string, readonly string[]]
> = {
  npm: ['npm', ['install', '-g', 'cc-expand@latest']],
  pnpm: ['pnpm', ['add', '-g', 'cc-expand@latest']],
  yarn: ['yarn', ['global', 'add', 'cc-expand']],
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

export async function selfUpdateCommand(options?: SelfUpdateOptions): Promise<CommandResult> {
  const detector = options?.installMethodDetector ?? new InstallMethodDetector()
  const method = await detector.detect()

  // npx 特判：每次自动拉最新，无需 self-update
  if (method === 'npx') {
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.npxHint'),
    }
  }

  // unknown：无法自动决定，引导用户配置
  if (method === 'unknown') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.unknownMethod'),
      t('suggestion.selfUpdate.unknownMethod'),
    )
  }

  // 强制查最新版（skipCache：手动执行不读缓存，拉真实 registry）
  const currentVersion = options?.currentVersion ?? readCurrentVersion()
  const updateCheck = options?.updateCheckService ?? new UpdateCheckService({ currentVersion })
  const info = await updateCheck.check({ skipCache: true })

  // 已是最新 → 跳过 spawn
  if (info && !info.hasUpdate) {
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.alreadyLatest', { version: currentVersion }),
    }
  }

  // 有更新或查询失败（info=null）→ 执行 spawn
  const [cmd, args] = UPDATE_COMMANDS[method]
  const spawner = options?.spawner ?? createDefaultSpawner()

  try {
    const result = await spawner(cmd, args)
    if (result.code !== 0) {
      return makeErrorResult(
        'self-update',
        ErrorCode.SELF_UPDATE_FAILED,
        t('error.selfUpdate.exitCode', { code: result.code ?? 'killed' }),
      )
    }

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
              latest: info.latestVersion,
            }),
            t('warning.selfUpdate.registryHint'),
          ],
        }
      }
      return {
        success: true,
        command: 'self-update',
        summary: t('command.selfUpdate.updated', {
          from: info.currentVersion,
          to: info.latestVersion,
        }),
      }
    }

    // info=null（版本查询失败）→ 无法验证，直接报成功
    return {
      success: true,
      command: 'self-update',
      summary: t('command.selfUpdate.success'),
    }
  } catch (error) {
    return handleSpawnError(error)
  }
}

/** 默认 spawner：用 spawn + stdio inherit，让包管理器原生输出直通终端 */
function createDefaultSpawner(): Spawner {
  return (cmd: string, args: readonly string[]) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'inherit' })
      child.on('close', (code) => resolve({ code }))
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
      t('suggestion.selfUpdate.eacces'),
    )
  }
  if (err.code === 'ENOENT') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      t('error.selfUpdate.enoent', { message: err.message }),
      t('suggestion.selfUpdate.enoent'),
    )
  }
  return makeErrorResult(
    'self-update',
    ErrorCode.SELF_UPDATE_FAILED,
    t('error.selfUpdate.generic', { message: err.message ?? String(error) }),
  )
}
