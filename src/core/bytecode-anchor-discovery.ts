/**
 * bytecode 常量池锚点发现：把手工实证流程工程化。
 * 输入 semantic signature（源文本锚）与 sourceTokens（常量池槽位现值），
 * 经 模块定位 → 槽位候选 → 伴生扩展唯一化 → binary 级实证 四步，
 * 产出可直接交给 BytecodePatchEngine 的锚点序列（{{tokens}} + 伴生 hex）。
 * 唯一性是硬约束：常量池 slot 相邻密集，单值常命中等差数列表等巧合数据，
 * 必须多连上下文排除；任何不确定性一律 throw（fail loud），不降级产出。
 */
import { Buffer } from 'node:buffer'
import { extractBunSection } from './binary-sections.js'
import { parseStandaloneGraph, readModuleContents, type Span } from './standalone-graph.js'
import { BytecodePatchEngine } from './bytecode-patch-engine.js'

const SLOT_WIDTH = 4
/** 伴生槽位扩展上限：扩到 8 个伴生（36B）仍不唯一即放弃该候选 */
const MAX_COMPANIONS = 8
/** 实证档位：与 pattern-gen 的 write 档位一致，仅用于证明锚点可 patch 且唯一 */
const PROBE_TARGET_TOKENS = 256000

export function discoverBytecodeAnchor(buffer: Buffer, signature: string, sourceTokens: number): string[] {
  const section = extractBunSection(buffer)
  const graph = parseStandaloneGraph(buffer, section)

  const hits = graph.modules.filter((m) => readModuleContents(buffer, m).includes(signature))
  if (hits.length === 0) {
    throw new Error(`bytecode anchor: signature 未命中任何模块（signature=${signature}）`)
  }
  if (hits.length > 1) {
    throw new Error(`bytecode anchor: signature 命中 ${hits.length} 个模块，无法确定目标（signature=${signature}）`)
  }
  const target = hits[0]
  const bc = target.bytecode
  if (bc.len === 0) {
    throw new Error('bytecode anchor: 目标模块 bytecode 区间为空，无常量池可锚定')
  }

  // 槽位候选：目标模块 bytecode 区间内全部 sourceTokens 出现位置（indexOf 字节搜索，
  // 常量编码各平台同为 Int32 小端）
  const needle = Buffer.alloc(SLOT_WIDTH)
  needle.writeUInt32LE(sourceTokens)
  const slots: number[] = []
  let offset = bc.off
  while (true) {
    const idx = buffer.indexOf(needle, offset)
    if (idx === -1 || idx + SLOT_WIDTH > bc.off + bc.len) break
    slots.push(idx)
    offset = idx + 1
  }
  if (slots.length === 0) {
    throw new Error(
      `bytecode anchor: 目标模块 bytecode 内无 ${sourceTokens} 槽位（常量可能被 Double 化或编译变化）`,
    )
  }

  // 纯槽位 needle（n=0）的全 binary 计数对所有候选必然相同，提前算一次：
  // ===1 时全 binary 仅此一处，n=0 即唯一；≥2 时所有候选的 n=0 都不唯一，直接从 n=1 扩展
  const baseCount = countOccurrencesCapped(buffer, needle)

  const qualified: string[] = []
  for (const pos of slots) {
    const pattern = extendToUnique(buffer, bc, pos, sourceTokens, baseCount)
    if (pattern !== null) qualified.push(pattern)
  }
  if (qualified.length !== 1) {
    throw new Error(
      `bytecode anchor: 合格候选 ${qualified.length} 个，应为恰好 1 个（槽位候选 ${slots.length} 个）`,
    )
  }

  // binary 级实证：对副本执行 patch → verify，实证不过不配锚点。
  // 副本隔离保证原 buffer 不被改写（已 patch 的槽位源值已消失，不可重放）。
  const engine = new BytecodePatchEngine()
  const copy = Buffer.from(buffer)
  const patched = engine.patch(copy, {
    bytecodePatterns: [qualified[0]],
    targetTokens: PROBE_TARGET_TOKENS,
    sourceTokens,
  })
  if (!patched.success || patched.replaceCount !== 1) {
    const why = patched.success
      ? `replaceCount=${patched.replaceCount}`
      : `${patched.error?.code}: ${patched.error?.message}`
    throw new Error(`bytecode anchor: 实证 patch 失败（${why}）`)
  }
  const verified = engine.verify(copy, {
    bytecodePatterns: [qualified[0]],
    targetTokens: PROBE_TARGET_TOKENS,
    sourceTokens,
  })
  if (!verified.success) {
    throw new Error(`bytecode anchor: 实证 verify 失败（${verified.error?.code}: ${verified.error?.message}）`)
  }

  return [qualified[0]]
}

/**
 * 从槽位起点向后逐 4B 追加伴生：每步把 sourceTokens 填进首槽得到完整字节串，
 * 做全 binary 唯一性检查；首次恰好命中 1 次即合格，返回 '{{tokens}}' + 伴生序列 hex。
 * n=0（纯槽位）判定已由调用方以 baseCount 统一做过：===1 时全 binary 仅此一处，
 * 该候选即纯槽位锚点（slots 搜索已保证此处在目标模块区间内）。
 * 伴生只读目标模块 bytecode 区间内相邻字节，越界即该候选失败；8 个伴生仍不唯一返回 null。
 */
function extendToUnique(
  buffer: Buffer,
  bc: Span,
  pos: number,
  sourceTokens: number,
  baseCount: number,
): string | null {
  if (baseCount === 1) return '{{tokens}}'
  for (let n = 1; n <= MAX_COMPANIONS; n++) {
    const total = SLOT_WIDTH + n * SLOT_WIDTH
    if (pos + total > bc.off + bc.len) return null
    const bytes = Buffer.alloc(total)
    bytes.writeUInt32LE(sourceTokens, 0)
    buffer.copy(bytes, SLOT_WIDTH, pos + SLOT_WIDTH, pos + total)
    if (countOccurrencesCapped(buffer, bytes) === 1) {
      return '{{tokens}}' + bytes.subarray(SLOT_WIDTH).toString('hex')
    }
  }
  return null
}

/**
 * 全 binary 出现次数，三态语义（0/1/≥2）：调用方只需「是否恰好唯一」，
 * 数到 2 即短路返回，非唯一场景不再数完全程（150MB 级 binary 上避免无谓全扫）。
 * indexOf 循环，offset 推进 idx+1 防重叠命中。
 */
function countOccurrencesCapped(buffer: Buffer, needle: Buffer): number {
  let count = 0
  let offset = 0
  while (count < 2) {
    const idx = buffer.indexOf(needle, offset)
    if (idx === -1) break
    count++
    offset = idx + 1
  }
  return count
}
