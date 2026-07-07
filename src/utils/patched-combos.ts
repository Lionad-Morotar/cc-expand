/**
 * combos 权威读取的统一入口（ADR 0003 第 6 点）。
 *
 * plugin 体系下 patchedVersions 记录的权威 schema 是 combos（shortVer 组合，如 "27w-flow"）；
 * 旧 schema targets（number[]）仅在 legacy 数据中留存，由 getUserConfig 内存迁移补齐 combos（不写盘）。
 *
 * 为什么集中到一个 helper：读侧曾因各命令各自实现派生逻辑而漏判 combos-only 新版本
 * （migration 只读 targets → 误选重构前老版本作迁移源）。统一入口让"combos 优先 + targets legacy 回退"
 * 的判定只在一处维护，新命令复用即正确。
 */
import { formatTokenCount } from '@cc-expand/plugin-context-expand'

/**
 * 从单条 PatchedVersionInfo 提取 combos：
 * - combos 非空 → 原样返回（plugin 体系权威）
 * - 否则 targets 非空 → 经 formatTokenCount 派生（与 ConfigService.getUserConfig 迁移同构）
 * - 两者皆空 → 空数组
 *
 * 注意：combos 与 targets 互斥返回（combos 优先），不合并。
 * 需要合集（如 patch-remove 同时清理新旧命名的 binary）的场景应自行合并，不用本 helper。
 */
export function extractCombos(info: { combos?: string[]; targets?: number[] } | undefined): string[] {
  if (!info) return []
  if (info.combos && info.combos.length > 0) return [...info.combos]
  if (info.targets && info.targets.length > 0) return info.targets.map(t => formatTokenCount(t))
  return []
}
