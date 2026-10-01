/**
 * silence-unrecognized-model 插件的 guard 锚点发现。
 *
 * 目标 guard 源码 `if(n==="model_validation")return;`（告警发射器 Yre 的首个判断）在
 * CC ≥2.1.246 的 bytecode 体制下编译为一条融合跳转 + 早退：
 *
 *   jnstricteq(0x52) lhs:arg2(0x07) rhs:const"model_validation"(0x11) 跳转偏移(0x06)
 *   ret(0x6a) const:undefined(0x12)
 *
 * patch 语义：跳转偏移 06→04 使跳转目标落到紧随的 ret，相等与否都早退，告警恒不发。
 *
 * 指令骨架字节（操作码、寄存器编码、const 槽位）是 v2.1.285 的实测值：CC 的 bun 是
 * 内部 fork 且禁用了 bytecode dump env，无法同版差分重放，跨版本漂移无法预测。
 * 因此任何一步不确定（signature 未命中、骨架零命中、唯一化失败）一律 throw
 * 触发人工重研究，不产出存疑锚点。候选内哪个是 Yre 结构上不可判（同形 gate），
 * 由生成器层做 runtime 探活选定，本模块只负责把候选准备到「可 patch、可探活」。
 */
import { Buffer } from 'node:buffer'
import { extractBunSection } from './binary-sections.js'
import { parseStandaloneGraph, readModuleContents } from './standalone-graph.js'
import { PatchEngine } from './patch-engine.js'

/** 模块 signature：Yre 所在 chunk 的源文本锚（contents 区间，latin1 存储） */
const MODULE_SIGNATURE = 'unrecognized-model-signal:'
/**
 * guard 指令骨架（6B）：jnstricteq + ret 融合序列。
 * const 槽位（0x11/0x12）绑定该模块常量池布局，与操作码同属实测锚
 */
const SKELETON = Buffer.from([0x52, 0x07, 0x11, 0x06, 0x6a, 0x12])
/** 跳转偏移字节在骨架内的位置（patch 槽位）：[52,07,11,06,6a,12] 的第 4 字节 */
const SLOT_OFFSET_IN_SKELETON = 3
/** 上下文扩展上限（前+后总字节）：超过仍不唯一即判该候选失败 */
const MAX_CONTEXT = 16

export interface SilenceGuardCandidate {
  /** 唯一化锚（latin1 字符串），直接作 PatchItem.search */
  search: string
  /** 跳转偏移现值，直接作 PatchItem.sourceValue */
  sourceValue: string
  /** 消音目标值，直接作 PatchItem.target */
  target: { value: string }
  desc: string
  /** 跳转偏移字节的文件绝对偏移（探活 patch 的写入位置） */
  offset: number
  /** 骨架起点在模块 bytecode 区间内的相对偏移（跨平台 blob 同构性对齐键） */
  offsetInModule: number
}

export function discoverSilenceGuardCandidates(buffer: Buffer): SilenceGuardCandidate[] {
  const section = extractBunSection(buffer)
  const graph = parseStandaloneGraph(buffer, section)

  const hits = graph.modules.filter((m) => readModuleContents(buffer, m).includes(MODULE_SIGNATURE))
  if (hits.length === 0) {
    throw new Error(`silence guard: signature 未命中任何模块（signature=${MODULE_SIGNATURE}）`)
  }
  if (hits.length > 1) {
    throw new Error(`silence guard: signature 命中 ${hits.length} 个模块，无法确定目标`)
  }
  const module = hits[0]
  const bc = module.bytecode
  if (bc.len === 0) {
    throw new Error('silence guard: 目标模块 bytecode 区间为空')
  }

  // 骨架命中：仅统计完全落在模块 bytecode 区间内的出现
  const matches: number[] = []
  let offset = bc.off
  while (true) {
    const idx = buffer.indexOf(SKELETON, offset)
    if (idx === -1 || idx + SKELETON.length > bc.off + bc.len) break
    matches.push(idx)
    offset = idx + 1
  }
  if (matches.length === 0) {
    throw new Error(
      'silence guard: 目标模块 bytecode 内无指令骨架，操作码或常量池布局已漂移，须人工重研究',
    )
  }

  const candidates: SilenceGuardCandidate[] = []
  for (const match of matches) {
    const anchor = extendToUnique(buffer, bc, match)
    candidates.push({
      search: anchor.toString('latin1'),
      sourceValue: '\u0006',
      target: { value: '\u0004' },
      desc: 'silence-unrecognized-model guard',
      offset: match + SLOT_OFFSET_IN_SKELETON,
      offsetInModule: match - bc.off,
    })
  }

  // 引擎级实证：每个候选作为 literal PatchItem 必须在副本上恰好替换一次
  // （副本隔离保证原 buffer 不被改写，探活由生成器另行执行）
  for (const c of candidates) {
    const copy = Buffer.from(buffer)
    const result = new PatchEngine().patch(copy, [c], () => {
      throw new Error('silence guard: literal patch 不应触发 token generator')
    })
    if (!result.success || result.replaceCount !== 1) {
      throw new Error(
        `silence guard: 候选实证失败（${result.error?.message ?? `replaceCount=${result.replaceCount}`}）`,
      )
    }
  }

  return candidates
}

/**
 * 上下文扩展至全 binary 唯一。按 (前缀, 后缀) 总字节数递增枚举组合，
 * 跳过两类无效组合：锚内 0x06 首现位置被污染（前缀引入更早的 0x06 会让
 * PatchEngine 的 indexOf 槽位定位写错位置）或锚内 0x06 不止一次（lastIndexOf 校验）。
 * 扩展只取模块 bytecode 区间内字节，越界组合跳过；总长超上限仍不唯一返回失败。
 */
function extendToUnique(buffer: Buffer, bc: { off: number; len: number }, match: number): Buffer {
  const end = match + SKELETON.length
  for (let total = 0; total <= MAX_CONTEXT; total++) {
    for (let prefix = 0; prefix <= total; prefix++) {
      const suffix = total - prefix
      const start = match - prefix
      if (start < bc.off || end + suffix > bc.off + bc.len) continue
      const anchor = buffer.subarray(start, end + suffix)
      // 槽位校验：0x06 在锚内恰好一次且位于骨架内原位
      const slotIdx = anchor.indexOf(Buffer.from([0x06]))
      const expected = prefix + SLOT_OFFSET_IN_SKELETON
      if (slotIdx !== expected) continue
      if (anchor.lastIndexOf(Buffer.from([0x06])) !== expected) continue
      if (countOccurrencesCapped(buffer, anchor) === 1) return Buffer.from(anchor)
    }
  }
  throw new Error(
    `silence guard: 骨架 @${match} 扩展 ${MAX_CONTEXT}B 仍不唯一，无法产出安全锚点`,
  )
}

/** 全 binary 出现次数，数到 2 短路（唯一性判定只需三态，150MB 级 binary 避免全扫） */
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
