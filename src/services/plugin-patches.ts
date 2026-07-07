/**
 * 收集 plugin 上下文：构造 PluginsManager + 拉取 enabled installed plugins 的 per-version shard patches。
 *
 * 为什么独立成模块：patch 命令与 migration 命令都需要这套「pluginsManager + installedPatches」，
 * 提取共享保证两路径产出一致（binary 命名同 shortVer、installed 能力同集合）——
 * 否则 migration 会退化用 String(target) 命名且丢失 installed patches（C9）。
 *
 * installed plugin 的 patches 来自各 manifest.shardBaseUrl 的远程 shard（按 os/arch 选取，universal 回退）；
 * internal plugin（token-expansion）的 patches 不在此收集，仍由 PatchApplier 经 ConfigService（OSS）拉取，
 * 其是否应用由 pluginsManager 的 enabled 状态在 applier 内判定。
 */
import { join } from 'node:path'
import { PluginsManager } from './plugins-manager.js'
import { PatternService } from './pattern.js'
import type { InternalPluginDefinition } from '../types/plugins.js'
import type { PatchItem } from '../types/index.js'

export interface PluginContext {
  pluginsManager: PluginsManager
  /** enabled installed plugins 的 literal-target patches（已按当前 os/arch 选取） */
  installedPatches: PatchItem[]
}

export interface CollectPluginContextOptions {
  internalPlugins: InternalPluginDefinition[]
  homeDir: string
  /** 目标 CC 版本（拉 per-version shard 用） */
  version: string
}

/** 第三方 shard 的 patch item 运行时校验：search/sourceValue 必须为 string，
 *  target 若有则须含 string value。非法 item 不进 patches，避免到 PatchEngine 深处才报错。 */
function isValidPatchItem(p: unknown): p is PatchItem {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  if (typeof o.search !== 'string' || typeof o.sourceValue !== 'string') return false
  if (o.target !== undefined) {
    if (typeof o.target !== 'object' || o.target === null) return false
    const t = o.target as Record<string, unknown>
    if (typeof t.value !== 'string') return false
  }
  return true
}

export async function collectPluginContext(
  options: CollectPluginContextOptions
): Promise<PluginContext> {
  const pluginsManager = new PluginsManager({
    internalPlugins: options.internalPlugins,
    homeDir: options.homeDir
  })

  const installedPatches: PatchItem[] = []
  for (const p of pluginsManager.ordered().filter(x => x.source === 'installed')) {
    const shardService = new PatternService({
      baseUrl: p.manifest.shardBaseUrl,
      cacheDir: join(options.homeDir, '.cc-expand', 'cache', 'plugins', p.name)
    })
    const shard = await shardService.fetchVersionPattern(options.version)
    const archPatches = shard?.[process.platform]?.[process.arch]
      ?? shard?.[process.platform]?.['universal']
      ?? []
    // shard 未覆盖当前平台 → 该 plugin 无 patches，warn 提示（单 plugin 失败不影响整体）
    if (archPatches.length === 0) {
      console.warn(`[ccx] plugin "${p.name}" 无 ${process.platform}/${process.arch} 的 patches，跳过`)
      continue
    }
    // 校验 patch item 结构，过滤非法
    const validPatches = archPatches.filter(isValidPatchItem)
    if (validPatches.length < archPatches.length) {
      console.warn(`[ccx] plugin "${p.name}" 跳过 ${archPatches.length - validPatches.length} 个非法 patch item`)
    }
    installedPatches.push(...validPatches)
  }

  return { pluginsManager, installedPatches }
}
