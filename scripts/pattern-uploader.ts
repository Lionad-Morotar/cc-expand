/**
 * Pattern 上传器：带内容 hash 去重 + 持久化缓存 + 指数退避重试
 *
 * Why: scripts/watch-patterns.ts 原先的去重表 uploadedHashes 是内存 Map，
 * 进程一重启就丢失，导致每次启动对 patterns/ 全量重传到 OSS。
 * 抽出本类把"去重 + 缓存持久化 + 重试"封装为可注入依赖的服务，
 * 便于单元测试（注入 fake UploadClient + tmp 缓存路径 + 零退避）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

/** 最小上传客户端接口（依赖倒置；运行时由 ali-oss 适配，测试注入 fake） */
export interface UploadClient {
  put(objectKey: string, localPath: string): Promise<unknown>
}

export type UploadOutcome = 'uploaded' | 'skipped' | 'failed'

export interface PatternUploaderOptions {
  client: UploadClient
  /** 持久化缓存文件路径，记录 filePath → contentHash，跨重启复用 */
  cachePath: string
  /** OSS 对象 key 前缀，默认 'patterns/' */
  prefix?: string
  /** 失败重试次数，默认 3（总尝试次数 = 1 + retryLimit） */
  retryLimit?: number
  /** 计算第 attempt 次重试前的退避毫秒，默认指数退避 2^attempt * 1000；测试可注入 0 跳过等待 */
  retryDelay?: (attempt: number) => number
}

export class PatternUploader {
  private readonly client: UploadClient
  private readonly cachePath: string
  private readonly prefix: string
  private readonly retryLimit: number
  private readonly retryDelay: (attempt: number) => number
  private readonly cache: Map<string, string>

  constructor(options: PatternUploaderOptions) {
    this.client = options.client
    this.cachePath = options.cachePath
    this.prefix = options.prefix ?? 'patterns/'
    this.retryLimit = options.retryLimit ?? 3
    this.retryDelay = options.retryDelay ?? ((attempt) => 2 ** attempt * 1000)
    this.cache = PatternUploader.loadCache(this.cachePath)
  }

  /** 读取持久化缓存；文件缺失或 JSON 损坏均视为空缓存，不抛异常 */
  private static loadCache(cachePath: string): Map<string, string> {
    if (!existsSync(cachePath)) return new Map()
    try {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, string>
      return new Map(Object.entries(raw))
    } catch {
      return new Map()
    }
  }

  /** 落盘当前内存缓存；写入失败不影响上传主流程 */
  private saveCache(): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(Object.fromEntries(this.cache), null, 2))
    } catch {
      /* 缓存非关键路径，静默失败 */
    }
  }

  /** 计算文件内容 MD5（与 OSS 小文件 ETag 同构，可作服务端比对基准） */
  private getFileHash(filePath: string): string {
    return createHash('md5').update(readFileSync(filePath)).digest('hex')
  }

  /** 带指数退避的上传重试；全部耗尽返回 false */
  private async putWithRetry(objectKey: string, localPath: string): Promise<boolean> {
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      try {
        await this.client.put(objectKey, localPath)
        return true
      } catch {
        if (attempt === this.retryLimit) return false
        const delay = this.retryDelay(attempt)
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }
    return false
  }

  async uploadFile(localPath: string): Promise<UploadOutcome> {
    const hash = this.getFileHash(localPath)
    if (this.cache.get(localPath) === hash) {
      return 'skipped'
    }
    const objectKey = `${this.prefix}${basename(localPath)}`
    const ok = await this.putWithRetry(objectKey, localPath)
    if (!ok) return 'failed'
    this.cache.set(localPath, hash)
    this.saveCache()
    return 'uploaded'
  }
}
