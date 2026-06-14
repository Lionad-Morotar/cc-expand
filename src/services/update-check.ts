/**
 * UpdateCheckService — 更新检查深度模块
 *
 * 封装：节流（本地缓存）+ fetch npm registry + semver 比较 + 静默失败 + atomic write。
 * 接口只有 check()，返回 UpdateInfo 或 null（检查失败/跳过时）。
 *
 * 设计原则：隐式检查的契约是"绝不能因自身失败打扰用户"，
 * 所以所有异常路径都降级为返回 null，由调用方决定是否提示。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { getUserConfigPath } from './user-config.js'

export interface UpdateCheckServiceOptions {
  /** 节流文件路径（测试注入用），默认与 config.json 同目录的 update-check.json */
  cachePath?: string
  /** npm registry endpoint，默认 cc-expand 的 latest manifest */
  registryUrl?: string
  /** 当前 cc-expand 版本 */
  currentVersion: string
  /** 节流间隔（毫秒），默认 24 小时 */
  intervalMs?: number
}

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
}

interface UpdateCheckState {
  lastCheckedAt: string
  lastKnownLatest: string
}

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org/cc-expand/latest'
const DEFAULT_INTERVAL_MS = 86_400_000
const FETCH_TIMEOUT_MS = 3000

function getDefaultCachePath(): string {
  return join(dirname(getUserConfigPath()), 'update-check.json')
}

export class UpdateCheckService {
  private readonly cachePath: string
  private readonly registryUrl: string
  private readonly currentVersion: string
  private readonly intervalMs: number

  constructor(options: UpdateCheckServiceOptions) {
    this.cachePath = options.cachePath ?? getDefaultCachePath()
    this.registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL
    this.currentVersion = options.currentVersion
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  /**
   * 检查是否有新版本可用。
   *
   * 节流策略：若本地 state 在 intervalMs 内已检查过，直接用缓存的 lastKnownLatest
   * 比较，不发网络请求。否则发请求并写回 state。
   *
   * @returns UpdateInfo（含 hasUpdate 标志），或 null（检查失败/跳过，调用方应静默）
   */
  async check(): Promise<UpdateInfo | null> {
    // 1. 节流：读缓存 state，命中则不发请求
    const cached = this.readState()
    if (cached && this.isFresh(cached)) {
      const latest = cached.lastKnownLatest
      if (!semver.valid(latest)) return null
      return {
        hasUpdate: semver.gt(latest, this.currentVersion),
        currentVersion: this.currentVersion,
        latestVersion: latest,
      }
    }

    // 2. 节流未命中，发请求
    try {
      const response = await fetch(this.registryUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const data = (await response.json()) as { version?: string }
      const latest = data.version
      if (!latest || !semver.valid(latest)) return null

      // 3. 写回 state 供下次节流
      this.writeState({
        lastCheckedAt: new Date().toISOString(),
        lastKnownLatest: latest,
      })

      return {
        hasUpdate: semver.gt(latest, this.currentVersion),
        currentVersion: this.currentVersion,
        latestVersion: latest,
      }
    } catch {
      return null
    }
  }

  /** 读取节流 state；文件缺失或损坏时返回 null（静默降级） */
  private readState(): UpdateCheckState | null {
    try {
      if (!existsSync(this.cachePath)) return null
      const raw = readFileSync(this.cachePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<UpdateCheckState>
      if (!parsed.lastCheckedAt || !parsed.lastKnownLatest) return null
      return {
        lastCheckedAt: parsed.lastCheckedAt,
        lastKnownLatest: parsed.lastKnownLatest,
      }
    } catch {
      return null
    }
  }

  /** 判断 state 是否仍在节流窗口内 */
  private isFresh(state: UpdateCheckState): boolean {
    const checkedAt = new Date(state.lastCheckedAt).getTime()
    if (Number.isNaN(checkedAt)) return false
    return Date.now() - checkedAt < this.intervalMs
  }

  /** 写回节流 state；写入失败不影响返回结果（静默） */
  private writeState(state: UpdateCheckState): void {
    try {
      const dir = dirname(this.cachePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.cachePath, JSON.stringify(state, null, 2))
    } catch {
      // 写入失败不影响检查结果
    }
  }
}
