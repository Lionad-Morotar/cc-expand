/**
 * LatestCacheService — 最新版本查询的 TTL 缓存
 *
 * 为什么需要：status / list 的迁移提示要问 registry "现在最新版是多少"，这是这两条命令
 * 唯一剩下的网络成本（实测 npm view 约 340ms，占修复后墙钟八成）。提示语义是"有新版可迁移"，
 * 分钟级陈旧无害，因此可用 TTL 缓存吸收重复查询；与 update-check.ts 对自更新提示的节流同源。
 *
 * 不缓存失败：解析失败（断网/超时/registry 抖动）直接返回 undefined 且不写盘，
 * 否则一次抖动会被固化成整个 TTL 周期内的"无新版可迁移"。
 *
 * 缓存文件与 config.json 同目录（~/.config/cc-expand/latest-versions.json），按包名分键，
 * 与 update-check.json 的节流状态互不干扰：前者是"最新版是多少"，后者是"上次查的是什么时候"。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { queryLatestVersion } from './latest-checker.js'
import { getUserConfigPath } from './user-config.js'

/** 默认 TTL：10 分钟。迁移提示不是升级动作，够新即可；升级路径（migration）不读本缓存 */
const DEFAULT_TTL_MS = 600_000

/** 默认查询的包 */
export const DEFAULT_LATEST_PACKAGE = '@anthropic-ai/claude-code'

interface LatestCacheEntry {
  /** 该版本被解析到的时刻（ISO） */
  checkedAt: string
  version: string
}

type LatestCacheState = Record<string, LatestCacheEntry>

export interface LatestCacheServiceOptions {
  /** 缓存文件路径（测试注入用），默认与 config.json 同目录的 latest-versions.json */
  cachePath?: string
  /** 版本解析器（测试注入用），默认走 npm view 查询用户 registry */
  resolver?: (packageName: string) => Promise<string | undefined>
  /** TTL 毫秒；<= 0 表示禁用缓存，每次直查 */
  ttlMs?: number
  /** 时间源（测试注入用），默认 Date.now */
  now?: () => number
}

function getDefaultCachePath(): string {
  return join(dirname(getUserConfigPath()), 'latest-versions.json')
}

/** 环境变量覆盖 TTL，便于排查"提示为何没及时更新" */
function getDefaultTtlMs(): number {
  const raw = process.env.CCX_LATEST_CACHE_TTL_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_TTL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_TTL_MS
}

export class LatestCacheService {
  private readonly cachePath: string
  private readonly resolver: (packageName: string) => Promise<string | undefined>
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options?: LatestCacheServiceOptions) {
    this.cachePath = options?.cachePath ?? getDefaultCachePath()
    this.resolver =
      options?.resolver ?? (packageName => queryLatestVersion(4000, undefined, packageName))
    this.ttlMs = options?.ttlMs ?? getDefaultTtlMs()
    this.now = options?.now ?? Date.now
  }

  /**
   * 取包的最新版本，命中未过期缓存时不发网络请求。
   *
   * @param packageName 包名，默认 @anthropic-ai/claude-code
   * @returns 版本号；解析失败返回 undefined（调用方按"无法判断"处理，不写缓存）
   */
  async getLatest(packageName: string = DEFAULT_LATEST_PACKAGE): Promise<string | undefined> {
    if (this.ttlMs > 0) {
      const cached = this.readEntry(packageName)
      if (cached && this.isFresh(cached)) return cached.version
    }

    let latest: string | undefined
    try {
      latest = await this.resolver(packageName)
    } catch {
      return undefined
    }
    if (!latest) return undefined

    if (this.ttlMs > 0) this.writeEntry(packageName, latest)
    return latest
  }

  /** 读取单个包的缓存条目；文件缺失、损坏或字段不全时返回 null（静默降级） */
  private readEntry(packageName: string): LatestCacheEntry | null {
    try {
      if (!existsSync(this.cachePath)) return null
      const state = JSON.parse(readFileSync(this.cachePath, 'utf-8')) as LatestCacheState
      const entry = state?.[packageName]
      if (!entry?.checkedAt || !entry.version) return null
      return entry
    } catch {
      return null
    }
  }

  /** 判断条目是否仍在 TTL 窗口内 */
  private isFresh(entry: LatestCacheEntry): boolean {
    const checkedAt = Date.parse(entry.checkedAt)
    if (Number.isNaN(checkedAt)) return false
    return this.now() - checkedAt < this.ttlMs
  }

  /** 写入单个包的条目，保留其它包；写入失败静默（缓存不可用不应影响命令） */
  private writeEntry(packageName: string, version: string): void {
    try {
      const state = this.readState()
      state[packageName] = { checkedAt: new Date(this.now()).toISOString(), version }
      const dir = dirname(this.cachePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.cachePath, JSON.stringify(state, null, 2))
    } catch {
      // 缓存写入失败不影响返回值
    }
  }

  /** 读取整份缓存状态；损坏时以空状态重写，不阻塞主流程 */
  private readState(): LatestCacheState {
    try {
      if (!existsSync(this.cachePath)) return {}
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf-8')) as LatestCacheState
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
}
