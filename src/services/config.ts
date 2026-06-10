/**
 * 配置服务
 * 管理用户配置目录 (~/.cc-expand/) 和 patterns 数据
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
// tsup 构建时内联 JSON 内容
import patterns from '../data/patterns.json'

export const CONFIG_DIR = join(homedir(), '.cc-expand')
export const BACKUP_DIR = join(CONFIG_DIR, 'backups')
export const PATCHES_DIR = join(CONFIG_DIR, 'patches')

export interface PatchItem {
  search: string
  desc: string
  sourceValue: string
}

export interface PlatformPatterns {
  [arch: string]: PatchItem[]
}

export interface OsPatterns {
  [platform: string]: PlatformPatterns
}

export interface VersionConfig {
  platforms: OsPatterns
}

export interface VersionsJson {
  [version: string]: VersionConfig
}

export interface UserConfig {
  patchedVersions: Record<string, { targets: number[]; patchedAt: string }>
}

export class ConfigService {
  /** 确保配置目录存在 */
  ensureDirs(): void {
    for (const dir of [CONFIG_DIR, BACKUP_DIR, PATCHES_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  /** 读取 patterns.json（构建时内联） */
  getPatterns(): VersionsJson {
    return patterns as VersionsJson
  }

  /** 根据版本号 + 平台获取 patch 列表 */
  getPatternForVersion(version: string, os: string = process.platform, arch: string = process.arch): PatchItem[] | undefined {
    const versionConfig = this.getPatterns()[version]
    if (!versionConfig) return undefined

    const osPatterns = versionConfig.platforms[os]
    if (!osPatterns) return undefined

    const archPatterns = osPatterns[arch]
    if (!archPatterns) {
      // 回退到通用模式（如果存在）
      return osPatterns['universal']
    }

    return archPatterns
  }

  /** 读取用户配置 */
  getUserConfig(): UserConfig {
    const configPath = join(CONFIG_DIR, 'versions.json')
    if (!existsSync(configPath)) {
      return { patchedVersions: {} }
    }
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as UserConfig
  }

  /** 写入用户配置 */
  setUserConfig(config: UserConfig): void {
    const configPath = join(CONFIG_DIR, 'versions.json')
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  /** 记录已 patch 的版本 */
  recordPatchedVersion(version: string, targetTokens: number): void {
    const config = this.getUserConfig()
    if (!config.patchedVersions) {
      config.patchedVersions = {}
    }
    const existing = config.patchedVersions[version]
    if (existing) {
      if (!existing.targets.includes(targetTokens)) {
        existing.targets.push(targetTokens)
      }
      existing.patchedAt = new Date().toISOString()
    } else {
      config.patchedVersions[version] = {
        targets: [targetTokens],
        patchedAt: new Date().toISOString(),
      }
    }
    this.setUserConfig(config)
  }

  /** 获取备份目录路径 */
  getBackupDir(): string {
    return BACKUP_DIR
  }
}
