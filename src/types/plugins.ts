/**
 * Plugin 体系的类型定义（ADR 0003）。
 *
 * 为什么分文件：plugin 类型是新增领域模型，与现有 types/index.ts 的 patch/error 类型解耦，
 * 便于独立演化，也对应"内核零 token 知识"原则——这些类型通用，不耦合 token 细节。
 */

/** ShortVer-hook：plugin 贡献给 binary 命名的短标识生成方式 */
export type ShortVerHook
  = | { kind: 'token-target' } // 读 targetTokens，由 plugin strategies.shortVer 生成
    | { kind: 'literal', value: string } // 固定值（如 'flow'）

/** plugin 的 target 生成策略；仅 internal token-expansion 声明，与 item 的 target 字段互斥 */
export type TargetStrategy = { type: 'token-encode' }

/** Plugin manifest：极简元信息（shard 托管 patches，避免内嵌滞后） */
export interface PluginManifest {
  name: string // 唯一标识，kebab-case
  shardBaseUrl: string // per-version patches 远程地址
  shortVer: ShortVerHook
  target?: TargetStrategy // 仅 token-expansion 有
  version?: string
  description?: string
}

/** internal plugin 提供的策略函数集（注册到内核策略表） */
export interface PluginStrategies {
  targetEncode?: (slot: number, ctx: { targetTokens?: number }) => string
  shortVer?: (ctx: { targetTokens?: number }) => string
  parseInput?: (input: string) => number
}

/** internal plugin 的完整定义：manifest + 策略函数（子包 export，内核注入） */
export interface InternalPluginDefinition {
  manifest: PluginManifest
  strategies: PluginStrategies
}

/** list/ordered 的统一视图：internal 与 installed 同构 */
export interface PluginEntry {
  name: string
  source: 'internal' | 'installed'
  enabled: boolean
  manifest: PluginManifest
  installedAt?: string // installed 才有
}
