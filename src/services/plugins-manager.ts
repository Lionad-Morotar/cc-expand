/**
 * PluginsManager —— plugin 注册表与有序列表的 deep module（ADR 0003）。
 *
 * 为什么注入 internalPlugins：避免硬依赖具体 internal plugin 子包（如 token-expansion），
 * 让本模块可独立单测（fake internal）。生产时由 CLI 层 import 子包 definition 注入。
 *
 * 注册表布局（~/.cc-expand/plugins.json）：
 *   { installed: [{name, manifest, enabled, installedAt}], disabledInternal: [name, ...] }
 * 为什么 internal 的 enabled 单独存（disabledInternal）：internal 的 manifest 是代码常量
 *（随包分发，不在注册表），只有 enabled 状态需持久化；installed 整条记录（含 manifest）在注册表。
 */
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  InternalPluginDefinition,
  PluginEntry,
  PluginManifest
} from '../types/plugins.js'

const CONFIG_DIR = '.cc-expand'
const REGISTRY_FILE = 'plugins.json'

interface InstalledRecord {
  name: string
  manifest: PluginManifest
  enabled: boolean
  installedAt: string
}

interface Registry {
  installed: InstalledRecord[]
  disabledInternal: string[]
}

export interface PluginsManagerOptions {
  /** 注入的 internal plugin 定义集（生产从子包 import，测试 fake） */
  internalPlugins: InternalPluginDefinition[]
  /** 注册表根目录（测试隔离用），默认 homedir() */
  homeDir?: string
}

export class PluginsManager {
  private readonly internalPlugins: InternalPluginDefinition[]
  protected readonly homeDir: string
  private readonly registryPath: string

  constructor(options: PluginsManagerOptions) {
    this.internalPlugins = options.internalPlugins
    this.homeDir = options.homeDir ?? homedir()
    this.registryPath = join(this.homeDir, CONFIG_DIR, REGISTRY_FILE)
  }

  /** 注册表损坏（手编/写入中断）时降级为空，绝不让 PluginsManager 崩溃。
   *  必须返回全新字面量——不能复用常量对象，否则 add() 的 push 会跨实例污染共享数组。 */
  private readRegistry(): Registry {
    if (!existsSync(this.registryPath)) return { installed: [], disabledInternal: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as Partial<Registry>
      return {
        installed: Array.isArray(parsed.installed) ? parsed.installed : [],
        disabledInternal: Array.isArray(parsed.disabledInternal) ? parsed.disabledInternal : []
      }
    } catch {
      return { installed: [], disabledInternal: [] }
    }
  }

  private writeRegistry(registry: Registry): void {
    const dir = join(this.homeDir, CONFIG_DIR)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2))
  }

  /** 所有 plugin（internal + installed，含 disabled），internal 在前、installed 按 addTime */
  list(): PluginEntry[] {
    const registry = this.readRegistry()
    const internal: PluginEntry[] = this.internalPlugins.map(p => ({
      name: p.manifest.name,
      source: 'internal' as const,
      enabled: !registry.disabledInternal.includes(p.manifest.name),
      manifest: p.manifest
    }))
    const installed: PluginEntry[] = registry.installed.map(r => ({
      name: r.name,
      source: 'installed' as const,
      enabled: r.enabled,
      manifest: r.manifest,
      installedAt: r.installedAt
    }))
    return [...internal, ...installed]
  }

  /** enabled 子集，顺序同 list（internal 先、installed by addTime） */
  ordered(): PluginEntry[] {
    return this.list().filter(p => p.enabled)
  }

  get(name: string): PluginEntry | undefined {
    return this.list().find(p => p.name === name)
  }

  isInstalled(name: string): boolean {
    return this.readRegistry().installed.some(r => r.name === name)
  }

  isEnabled(name: string): boolean {
    return this.get(name)?.enabled ?? false
  }

  /** 安装或更新 installed plugin。
   *  - upsert：已存在则更新 manifest 字段、保留 enabled/installedAt（flow review 3，作者改 repo 后 add 即同步）
   *  - 拒绝与 internal plugin 同名：internal 名是保留命名空间（flow review 5）
   *  返回 'added' | 'updated' | 'conflict' 供调用方分类提示。 */
  add(manifest: PluginManifest): 'added' | 'updated' | 'conflict' {
    if (this.internalPlugins.some(p => p.manifest.name === manifest.name)) {
      return 'conflict'
    }
    const registry = this.readRegistry()
    const existing = registry.installed.find(r => r.name === manifest.name)
    if (existing) {
      existing.manifest = manifest
    } else {
      registry.installed.push({
        name: manifest.name,
        manifest,
        enabled: true,
        installedAt: new Date().toISOString()
      })
    }
    this.writeRegistry(registry)
    return existing ? 'updated' : 'added'
  }

  /** 卸载 installed plugin；internal 不可 remove（抛错） */
  remove(name: string): void {
    if (this.internalPlugins.some(p => p.manifest.name === name)) {
      throw new Error(`Internal plugin '${name}' cannot be removed`)
    }
    const registry = this.readRegistry()
    registry.installed = registry.installed.filter(r => r.name !== name)
    this.writeRegistry(registry)
  }

  enable(name: string): void {
    this.setEnabled(name, true)
  }

  disable(name: string): void {
    this.setEnabled(name, false)
  }

  /** internal 改 disabledInternal；installed 改记录的 enabled。
   *  不存在的 plugin 抛错而非静默（flow review CR#6）：避免 CLI 误报生效、disabledInternal 留垃圾条目。 */
  private setEnabled(name: string, enabled: boolean): void {
    const isInternal = this.internalPlugins.some(p => p.manifest.name === name)
    const registry = this.readRegistry()
    const installedRecord = registry.installed.find(r => r.name === name)
    if (!isInternal && !installedRecord) {
      throw new Error(`Plugin '${name}' not found`)
    }
    if (isInternal) {
      registry.disabledInternal = enabled
        ? registry.disabledInternal.filter(n => n !== name)
        : (registry.disabledInternal.includes(name) ? registry.disabledInternal : [...registry.disabledInternal, name])
    } else {
      installedRecord!.enabled = enabled
    }
    this.writeRegistry(registry)
  }

  /** 各 enabled plugin 的 shortVer 按序用 - 拼成 binary 命名段（如 27w-flow） */
  computeShortVer(ctx: { targetTokens?: number }): string {
    return this.ordered()
      .map(p => this.shortVerOf(p, ctx))
      .filter(s => s !== '')
      .join('-')
  }

  /** literal hook 取 value；token-target 查 internal 的 strategies.shortVer */
  private shortVerOf(p: PluginEntry, ctx: { targetTokens?: number }): string {
    if (p.manifest.shortVer.kind === 'literal') return p.manifest.shortVer.value
    const def = this.internalPlugins.find(d => d.manifest.name === p.name)
    return def?.strategies.shortVer?.(ctx) ?? ''
  }
}
