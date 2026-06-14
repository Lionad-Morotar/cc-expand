/**
 * self-update command — 更新 cc-expand 自身到最新 npm 版本
 *
 * 编排 InstallMethodDetector + spawner，按 installMethod 执行对应包管理器命令。
 * npx 特判提示；unknown 报错引导配置；EACCES 给 prefix 建议。
 *
 * 文案暂用硬编码，Slice F 抽到 i18n。
 */
import { spawn } from 'node:child_process'
import type { InstallMethod } from '../../types/index.js'
import { ErrorCode } from '../../types/index.js'
import { InstallMethodDetector } from '../../services/install-method.js'
import { makeErrorResult, type CommandResult } from '../result.js'

export interface SpawnResult {
  code: number | null
}

export type Spawner = (cmd: string, args: string[]) => Promise<SpawnResult>

export interface SelfUpdateOptions {
  installMethodDetector?: InstallMethodDetector
  spawner?: Spawner
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

export async function selfUpdateCommand(options?: SelfUpdateOptions): Promise<CommandResult> {
  const detector = options?.installMethodDetector ?? new InstallMethodDetector()
  const method = await detector.detect()

  // npx 特判：每次自动拉最新，无需 self-update
  if (method === 'npx') {
    return {
      success: true,
      command: 'self-update',
      summary: 'npx 每次自动拉取最新版，无需 self-update',
    }
  }

  // unknown：无法自动决定，引导用户配置
  if (method === 'unknown') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      '无法自动检测 cc-expand 的安装方式',
      '请用 `ccx config set installMethod <npm|pnpm|yarn>` 显式声明',
    )
  }

  const [cmd, args] = UPDATE_COMMANDS[method]
  const spawner = options?.spawner ?? createDefaultSpawner()

  try {
    const result = await spawner(cmd, args)
    if (result.code !== 0) {
      return makeErrorResult(
        'self-update',
        ErrorCode.SELF_UPDATE_FAILED,
        `更新失败，包管理器退出码 ${result.code}`,
      )
    }
    return {
      success: true,
      command: 'self-update',
      summary: '已更新到最新版，下次运行 ccx 即生效',
    }
  } catch (error) {
    return handleSpawnError(error)
  }
}

/** 默认 spawner：用 spawn + stdio inherit，让包管理器原生输出直通终端 */
function createDefaultSpawner(): Spawner {
  return (cmd: string, args: string[]) =>
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
      '权限不足，无法写入全局安装目录',
      '建议配置 npm prefix 到用户目录（npm config set prefix ~/.npm-global），或用 sudo（不推荐，可能破坏权限）',
    )
  }
  if (err.code === 'ENOENT') {
    return makeErrorResult(
      'self-update',
      ErrorCode.SELF_UPDATE_FAILED,
      `未找到命令：${err.message}`,
      '请确认对应的包管理器已安装并在 PATH 中',
    )
  }
  return makeErrorResult(
    'self-update',
    ErrorCode.SELF_UPDATE_FAILED,
    `更新失败：${err.message ?? String(error)}`,
  )
}
