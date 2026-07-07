/**
 * Pattern 远程拉取与缓存服务
 * 负责从 OSS 按需拉取版本 pattern，使用 ETag 条件请求减少流量
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PatchItem } from './config.js'

export interface VersionsIndexItem {
  version: string
  platforms: string[]
}

export interface OsPatterns {
  [os: string]: {
    [arch: string]: PatchItem[]
  }
}

export interface PatternServiceOptions {
  /** 缓存目录（测试注入用） */
  cacheDir?: string
  /** OSS 基础 URL（测试注入用） */
  baseUrl?: string
}

export class PatternService {
  private cacheDir: string
  private baseUrl: string

  constructor(options?: PatternServiceOptions) {
    this.cacheDir = options?.cacheDir ?? join(homedir(), '.cc-expand', 'cache', 'patterns')
    const rawBase = options?.baseUrl ?? 'https://cc-expand.oss-cn-shanghai.aliyuncs.com/patterns/'
    this.baseUrl = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
  }

  /** 校验版本号字符串是否安全（防止路径遍历） */
  private isValidVersion(version: string): boolean {
    return /^[a-zA-Z0-9_.-]+$/.test(version)
  }

  /** 确保缓存目录存在 */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  /** 读取本地缓存的 ETag */
  private getCachedEtag(version: string): string | undefined {
    const etagPath = join(this.cacheDir, `${version}.etag`)
    if (!existsSync(etagPath)) return undefined
    const etag = readFileSync(etagPath, 'utf-8')
    // 空字符串视为无 ETag
    return etag || undefined
  }

  /** 读取本地缓存的 pattern 数据 */
  private getCachedPattern(version: string): OsPatterns | undefined {
    const cachePath = join(this.cacheDir, `${version}.json`)
    if (!existsSync(cachePath)) return undefined
    try {
      return JSON.parse(readFileSync(cachePath, 'utf-8')) as OsPatterns
    } catch {
      // 缓存损坏时视为无缓存
      return undefined
    }
  }

  /** 写入缓存（数据 + ETag） */
  private writeCache(version: string, data: OsPatterns, etag: string): void {
    this.ensureCacheDir()
    const jsonPath = join(this.cacheDir, `${version}.json`)
    const etagPath = join(this.cacheDir, `${version}.etag`)
    try {
      writeFileSync(jsonPath, JSON.stringify(data, null, 2))
      // 空 ETag 不写入文件，避免无效条件请求
      if (etag) {
        writeFileSync(etagPath, etag)
      }
    } catch {
      // 清理可能部分写入的文件，避免缓存不一致
      try { rmSync(jsonPath, { force: true }) } catch { /* ignore */ }
      try { rmSync(etagPath, { force: true }) } catch { /* ignore */ }
    }
  }

  /**
   * 拉取特定版本的 pattern
   * 带 ETag 条件请求：304 时返回本地缓存，200 时更新缓存
   */
  async fetchVersionPattern(version: string): Promise<OsPatterns | undefined> {
    if (!this.isValidVersion(version)) return undefined
    const url = `${this.baseUrl}${version}.json`
    const etag = this.getCachedEtag(version)

    const headers: Record<string, string> = {}
    if (etag) {
      headers['If-None-Match'] = etag
    }

    try {
      const response = await fetch(url, { headers })

      if (response.status === 304) {
        return this.getCachedPattern(version)
      }

      if (response.status === 200) {
        const data = (await response.json()) as OsPatterns
        const responseEtag = response.headers.get('etag') ?? ''
        this.writeCache(version, data, responseEtag)
        return data
      }

      if (response.status === 404) {
        // 版本不存在，不降级到缓存
        return undefined
      }

      // 其他服务端错误（5xx 等）降级到本地缓存
      return this.getCachedPattern(version)
    } catch (error) {
      console.warn(
        `[PatternService] 获取版本 ${version} 失败，降级到本地缓存:`,
        error instanceof Error ? error.message : String(error)
      )
      return this.getCachedPattern(version)
    }
  }

  /** 拉取版本索引 */
  async fetchVersionsIndex(): Promise<VersionsIndexItem[]> {
    const version = 'versions'
    if (!this.isValidVersion(version)) return []
    const url = `${this.baseUrl}versions.json`
    const etag = this.getCachedEtag(version)

    const headers: Record<string, string> = {}
    if (etag) {
      headers['If-None-Match'] = etag
    }

    try {
      const response = await fetch(url, { headers })

      if (response.status === 304) {
        const cached = this.getCachedPattern('versions')
        return (cached as unknown as VersionsIndexItem[]) ?? []
      }

      if (response.status === 200) {
        const data = (await response.json()) as VersionsIndexItem[]
        const responseEtag = response.headers.get('etag') ?? ''
        this.writeCache('versions', data as unknown as OsPatterns, responseEtag)
        return data
      }
    } catch {
      // 网络失败时降级到本地缓存
    }

    const cached = this.getCachedPattern('versions')
    return (cached as unknown as VersionsIndexItem[]) ?? []
  }
}
