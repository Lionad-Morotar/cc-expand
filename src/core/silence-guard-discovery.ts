/**
 * silence-unrecognized-model 插件的 guard 锚点发现。
 *
 * 目标 guard 源码 `if(n==="model_validation")return;`（告警发射器 Yre 的首个判断）在
 * CC ≥2.1.246 的 bytecode 体制下编译为一条融合跳转 + 早退：
 *
 *   jnstricteq lhs:arg2(0x07) rhs:const"model_validation"(0x11) 跳转偏移(0x06)
 *   ret const:undefined(0x12)
 *
 * 操作码编号绑定 CC 内嵌 bun fork 的 JSC 基线（0x52/0x6a 起，随基线平移），见变体表。
 *
 * patch 语义：跳转偏移 06→04 使跳转目标落到紧随的 ret，相等与否都早退，告警恒不发。
 *
 * 指令骨架字节是逐基线实测值：CC 的 bun 是内部 fork 且禁用了 bytecode dump env，
 * 无法同版差分重放；fork 的 JSC 基线更新会在 opcode 表插入新指令，使后续所有
 * 操作码编号整体平移（guard 指令布局与操作数槽位值不变）。因此骨架按基线注册为
 * 变体表，漂移经「opcode 表 diff + 模块 bytecode 长程对齐」实测后追加新变体；
 * 多个变体同时命中说明搜索空间被污染，同样 fail loud。任何一步不确定
 * （signature 未命中、骨架零命中、唯一化失败）一律 throw 触发人工重研究，
 * 不产出存疑锚点。候选内哪个是 Yre 结构上不可判（同形 gate），
 * 由生成器层做 runtime 探活选定，本模块只负责把候选准备到「可 patch、可探活」。
 */
import { Buffer } from 'node:buffer'
import { extractBunSection } from './binary-sections.js'
import { parseStandaloneGraph, readModuleContents } from './standalone-graph.js'
import { PatchEngine } from './patch-engine.js'

/** 模块 signature：Yre 所在 chunk 的源文本锚（contents 区间，latin1 存储） */
const MODULE_SIGNATURE = 'unrecognized-model-signal:'
/**
 * guard 指令骨架变体（6B）：jnstricteq + ret 融合序列，按 JSC opcode 表基线注册。
 * 指令布局（op lhs rhs jump / op const）与操作数槽位跨基线不变：lhs=arg2(0x07)、
 * rhs const=0x11、jump=0x06、ret const=0x12；漂移只动操作码字节。
 * 实测溯源：首变体为 v2.1.285~v2.1.296 基线；次变体基线在官方 wk142→wk143 的
 * 两个 opcode 插入点之间（仅 new_reg_exp_shared 生效，jnstricteq 0x52→0x53、
 * ret 0x6a→0x6b），v2.1.299 五平台实测。
 */
const SKELETON_VARIANTS: Buffer[] = [
  Buffer.from([0x52, 0x07, 0x11, 0x06, 0x6a, 0x12]),
  Buffer.from([0x53, 0x07, 0x11, 0x06, 0x6b, 0x12]),
]
/** 跳转偏移字节在骨架内的位置（patch 槽位）：[op,lhs,rhs,jump,op,const] 的第 4 字节 */
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

  const signatureHits = graph.modules.filter((m) =>
    readModuleContents(buffer, m).includes(MODULE_SIGNATURE)
  )
  if (signatureHits.length === 0) {
    throw new Error(`silence guard: signature 未命中任何模块（signature=${MODULE_SIGNATURE}）`)
  }
  if (signatureHits.length > 1) {
    throw new Error(`silence guard: signature 命中 ${signatureHits.length} 个模块，无法确定目标`)
  }
  const module = signatureHits[0]
  const bc = module.bytecode
  if (bc.len === 0) {
    throw new Error('silence guard: 目标模块 bytecode 区间为空')
  }

  // 骨架命中：仅统计完全落在模块 bytecode 区间内的出现，且要求恰好一个变体命中
  // （多基线并存意味着模块被污染或注册表重叠，无法判定锚归属哪个基线语义）
  const matchedVariants = SKELETON_VARIANTS.map((skeleton) => ({
    skeleton,
    matches: scanSkeletonMatches(buffer, bc, skeleton),
  }))
  const hits = matchedVariants.filter((v) => v.matches.length > 0)
  if (hits.length === 0) {
    throw new Error(
      'silence guard: 目标模块 bytecode 内无指令骨架，操作码或常量池布局已漂移，须人工重研究',
    )
  }
  if (hits.length > 1) {
    throw new Error(
      `silence guard: ${hits.length} 个骨架基线同时命中目标模块，无法判定操作码基线，须人工重研究`,
    )
  }
  const { skeleton, matches } = hits[0]

  const candidates: SilenceGuardCandidate[] = []
  for (const match of matches) {
    const anchor = extendToUnique(buffer, bc, match, skeleton)
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

/** 骨架在模块 bytecode 区间内的全部出现（越出区间边界的截断出现不计） */
function scanSkeletonMatches(
  buffer: Buffer,
  bc: { off: number; len: number },
  skeleton: Buffer,
): number[] {
  const matches: number[] = []
  let offset = bc.off
  while (true) {
    const idx = buffer.indexOf(skeleton, offset)
    if (idx === -1 || idx + skeleton.length > bc.off + bc.len) break
    matches.push(idx)
    offset = idx + 1
  }
  return matches
}

/**
 * 上下文扩展至全 binary 唯一。按 (前缀, 后缀) 总字节数递增枚举组合，
 * 跳过两类无效组合：锚内 0x06 首现位置被污染（前缀引入更早的 0x06 会让
 * PatchEngine 的 indexOf 槽位定位写错位置）或锚内 0x06 不止一次（lastIndexOf 校验）。
 * 扩展只取模块 bytecode 区间内字节，越界组合跳过；总长超上限仍不唯一返回失败。
 */
function extendToUnique(
  buffer: Buffer,
  bc: { off: number; len: number },
  match: number,
  skeleton: Buffer,
): Buffer {
  const end = match + skeleton.length
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
