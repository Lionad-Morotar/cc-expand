/**
 * Shard 写入服务:把 PatternDiscovery 产出的 pattern 写成分片文件
 * - patterns/{version}.json: 扁平 OsPatterns 结构(os → arch → PatchItem[])
 * - patterns/versions.json: 版本索引,upsert 幂等
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OsPatterns, VersionsIndexItem } from './pattern.js'

export interface ShardWriterOptions {
  /** patterns 目录(测试注入用;默认 cwd/patterns) */
  patternsDir?: string
}

export class ShardWriter {
  private patternsDir: string

  constructor(options?: ShardWriterOptions) {
    this.patternsDir = options?.patternsDir ?? join(process.cwd(), 'patterns')
  }

  /**
   * 写出 patterns/{version}.json 分片文件
   * @returns 写入的文件绝对路径
   */
  writeShard(version: string, patterns: OsPatterns): string {
    this.ensureDir()
    const path = join(this.patternsDir, `${version}.json`)
    writeFileSync(path, JSON.stringify(patterns, null, 2))
    return path
  }

  /**
   * 幂等更新版本索引:同 version 已存在则更新 platforms,否则追加
   * 重复调用结果一致,不产生重复条目
   * bytecodePlatforms 仅在传入时写入;省略时保留条目已有值,
   * 因为锚点实证往往滞后于 pattern 生成,后续补证不应冲掉既有记录
   */
  upsertVersionIndex(version: string, platforms: string[], bytecodePlatforms?: string[]): void {
    this.ensureDir()
    const indexPath = join(this.patternsDir, 'versions.json')
    const items = this.readIndex(indexPath)
    const existing = items.findIndex(i => i.version === version)
    if (existing >= 0) {
      items[existing].platforms = platforms
      if (bytecodePlatforms !== undefined) {
        items[existing].bytecodePlatforms = bytecodePlatforms
      }
    } else {
      items.push({ version, platforms, ...(bytecodePlatforms !== undefined ? { bytecodePlatforms } : {}) })
    }
    writeFileSync(indexPath, JSON.stringify(items, null, 2))
  }

  private ensureDir(): void {
    if (!existsSync(this.patternsDir)) {
      mkdirSync(this.patternsDir, { recursive: true })
    }
  }

  private readIndex(indexPath: string): VersionsIndexItem[] {
    if (!existsSync(indexPath)) return []
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8')) as VersionsIndexItem[]
    } catch {
      // 索引损坏时视为空,避免阻塞写入
      return []
    }
  }
}
