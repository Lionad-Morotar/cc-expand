/**
 * 配置服务
 * 管理用户配置目录 (~/.cc-expand/) 和 patterns 数据
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PatternService, type VersionsIndexItem } from './pattern.js'
import { formatTokenCount } from '@cc-expand/plugin-context-expand'
import type { PatchItem } from '../types/index.js'

// re-export canonical PatchItem：原本地定义 desc 必填且无 target，
// 与 types/index.ts canonical（desc?/target?）分叉。统一到 canonical，pattern.ts 经此 re-export 也得正确形状。
export type { PatchItem }

export const CONFIG_DIR = join(homedir(), '.cc-expand')
export const BACKUP_DIR = join(CONFIG_DIR, 'backups')
export const PATCHES_DIR = join(CONFIG_DIR, 'patches')

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

export interface PatchedVersionInfo {
  /** 旧 schema，迁移后保留（向后兼容 status/list 仍读 targets） */
  targets?: number[]
  /** 新 schema：shortVer 组合（如 "27w"、"27w-flow"），plugin 体系的 binary 命名记录 */
  combos?: string[]
  patchedAt: string
}

export interface UserConfig {
  patchedVersions: Record<string, PatchedVersionInfo>
}

export interface ConfigServiceOptions {
  /** PatternService 实例（测试注入用） */
  patternService?: PatternService
  /** 覆盖默认 home 目录（测试隔离用），默认 homedir() */
  homeDir?: string
}

export class ConfigService {
  private patternService: PatternService
  private readonly configDir: string
  private readonly backupDir: string
  private readonly patchesDir: string

  constructor(options?: ConfigServiceOptions) {
    // 接受 homeDir 注入以支持测试隔离；默认 homedir()。CONFIG_DIR 常量仅作为 channel-config 的默认值
    const homeDir = options?.homeDir ?? homedir()
    this.configDir = join(homeDir, '.cc-expand')
    this.backupDir = join(this.configDir, 'backups')
    this.patchesDir = join(this.configDir, 'patches')
    this.patternService = options?.patternService ?? new PatternService()
  }

  /** 确保配置目录存在 */
  ensureDirs(): void {
    for (const dir of [this.configDir, this.backupDir, this.patchesDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  /** 获取所有支持的版本号列表 */
  async getSupportedVersions(): Promise<string[]> {
    const index = await this.patternService.fetchVersionsIndex()
    return index.map(item => item.version).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )
  }

  /** 获取版本索引（含平台信息，供 supports 命令使用） */
  async getVersionIndex(): Promise<VersionsIndexItem[]> {
    return this.patternService.fetchVersionsIndex()
  }

  /** 根据版本号 + 平台获取 patch 列表 */
  async getPatternForVersion(
    version: string,
    os: string = process.platform,
    arch: string = process.arch
  ): Promise<PatchItem[] | undefined> {
    const osPatterns = await this.patternService.fetchVersionPattern(version)
    if (!osPatterns) return undefined

    const platformPatterns = osPatterns[os]
    if (!platformPatterns) return undefined

    const archPatterns = platformPatterns[arch]
    if (!archPatterns) {
      // 回退到通用模式（如果存在）
      return platformPatterns['universal']
    }

    return archPatterns
  }

  /** 读取用户配置（自动迁移旧 targets → combos，targets 保留兼容） */
  getUserConfig(): UserConfig {
    const configPath = join(this.configDir, 'versions.json')
    if (!existsSync(configPath)) {
      return { patchedVersions: {} }
    }
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as UserConfig
    // 迁移：旧 targets → combos（formatTokenCount）；targets 保留（status/list 兼容）
    for (const info of Object.values(config.patchedVersions ?? {})) {
      if (info.targets && info.targets.length > 0 && (!info.combos || info.combos.length === 0)) {
        info.combos = info.targets.map(t => formatTokenCount(t))
      }
    }
    return config
  }

  /** 写入用户配置 */
  setUserConfig(config: UserConfig): void {
    const configPath = join(this.configDir, 'versions.json')
    // configDir 可能不存在（独立调用未走 ensureDirs，如测试/迁移），自动创建避免 ENOENT
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
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
      if (existing.targets && !existing.targets.includes(targetTokens)) {
        existing.targets.push(targetTokens)
      }
      existing.patchedAt = new Date().toISOString()
    } else {
      config.patchedVersions[version] = {
        targets: [targetTokens],
        patchedAt: new Date().toISOString()
      }
    }
    this.setUserConfig(config)
  }

  /** 记录已 patch 的 shortVer 组合（plugin 体系新 schema；幂等） */
  recordPatchedCombo(version: string, combo: string): void {
    const config = this.getUserConfig()
    if (!config.patchedVersions) {
      config.patchedVersions = {}
    }
    const existing = config.patchedVersions[version]
    if (existing) {
      if (!existing.combos) existing.combos = []
      if (!existing.combos.includes(combo)) {
        existing.combos.push(combo)
      }
      existing.patchedAt = new Date().toISOString()
    } else {
      config.patchedVersions[version] = {
        combos: [combo],
        patchedAt: new Date().toISOString()
      }
    }
    this.setUserConfig(config)
  }

  /** 移除指定版本的某个 combo。若移除后 combos 为空，则删除整个版本条目（含 legacy targets）。 */
  removePatchedCombo(version: string, combo: string): boolean {
    const config = this.getUserConfig()
    const existing = config.patchedVersions?.[version]
    if (!existing || !existing.combos || existing.combos.length === 0) {
      return false
    }
    const index = existing.combos.indexOf(combo)
    if (index === -1) return false
    existing.combos.splice(index, 1)
    if (existing.combos.length === 0) {
      delete config.patchedVersions[version]
    }
    this.setUserConfig(config)
    return true
  }

  /** 移除指定版本的全部 patch 记录（targets + combos）。 */
  removePatchedVersion(version: string): boolean {
    const config = this.getUserConfig()
    if (!config.patchedVersions?.[version]) {
      return false
    }
    delete config.patchedVersions[version]
    this.setUserConfig(config)
    return true
  }

  /** 获取备份目录路径 */
  getBackupDir(): string {
    return this.backupDir
  }
}
