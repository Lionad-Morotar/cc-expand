/**
 * bytecode 常量池锚点发现：把手工实证流程工程化。
 * 输入 semantic signature（源文本锚）与 sourceTokens（常量池槽位现值），
 * 经 模块定位 → 槽位候选 → 伴生扩展唯一化 → binary 级实证 四步，
 * 产出可直接交给 BytecodePatchEngine 的锚点序列（{{tokens}} + 伴生 hex）。
 * 唯一性是硬约束：常量池 slot 相邻密集，单值常命中等差数列表等巧合数据，
 * 必须多连上下文排除；任何不确定性一律 throw（fail loud），不降级产出。
 * 布局漂移下模块内可能出现多个同值 slot 且各自扩展均可唯一（唯一性失效），
 * 此时以「语义伴生」裁决：语义主项槽的右邻槽恒为源码中同组声明的伴生常量。
 */
import { Buffer } from 'node:buffer'
import { extractBunSection } from './binary-sections.js'
import { parseStandaloneGraph, readModuleContents, type Span } from './standalone-graph.js'
import { BytecodePatchEngine } from './bytecode-patch-engine.js'

const SLOT_WIDTH = 4
/** 锚点占位前缀，与 BytecodePatchEngine 的 TOKEN_PLACEHOLDER 同为 '{{tokens}}' */
const TOKEN_PLACEHOLDER = '{{tokens}}'
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
  if (qualified.length === 0) {
    throw new Error(`bytecode anchor: 合格候选 0 个，应为恰好 1 个（槽位候选 ${slots.length} 个）`)
  }
  // 单候选直接定（含 baseCount===1 时 n=0 纯槽位形态）；≥2 时唯一性已失效，改以语义伴生裁决
  const anchor =
    qualified.length === 1
      ? qualified[0]
      : resolveSemanticCandidate(qualified, signature, sourceTokens)

  // binary 级实证：对副本执行 patch → verify，实证不过不配锚点。
  // 副本隔离保证原 buffer 不被改写（已 patch 的槽位源值已消失，不可重放）。
  const engine = new BytecodePatchEngine()
  const copy = Buffer.from(buffer)
  const patched = engine.patch(copy, {
    bytecodePatterns: [anchor],
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
    bytecodePatterns: [anchor],
    targetTokens: PROBE_TARGET_TOKENS,
    sourceTokens,
  })
  if (!verified.success) {
    throw new Error(`bytecode anchor: 实证 verify 失败（${verified.error?.code}: ${verified.error?.message}）`)
  }

  return [anchor]
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
  if (baseCount === 1) return TOKEN_PLACEHOLDER
  for (let n = 1; n <= MAX_COMPANIONS; n++) {
    const total = SLOT_WIDTH + n * SLOT_WIDTH
    if (pos + total > bc.off + bc.len) return null
    const bytes = Buffer.alloc(total)
    bytes.writeUInt32LE(sourceTokens, 0)
    buffer.copy(bytes, SLOT_WIDTH, pos + SLOT_WIDTH, pos + total)
    if (countOccurrencesCapped(buffer, bytes) === 1) {
      return TOKEN_PLACEHOLDER + bytes.subarray(SLOT_WIDTH).toString('hex')
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

/**
 * 多候选语义裁决（唯一性失效时的兜底判别）：合格候选 ≥2 时唯一性已无法区分
 * （各自都能在全 binary 恰好命中 1 次），改以「语义伴生」判别——语义主项槽位的
 * 右邻槽恒为源码中同组声明的伴生常量（历史全部 anchor 首伴生恒为 0x007d0000/32000）。
 * 伴生值从 signature 的源码声明子串推导；命中恰好 1 个才返回，否则 fail loud，不自动挑。
 */
function resolveSemanticCandidate(qualified: string[], signature: string, sourceTokens: number): string {
  const companion = deriveCompanionTokens(signature, sourceTokens)
  if (companion === null) {
    throw new Error(
      `bytecode anchor: 合格候选 ${qualified.length} 个且签名无可推导的伴生常量（signature=${signature}），无法裁决`,
    )
  }
  const buf = Buffer.alloc(SLOT_WIDTH)
  buf.writeUInt32LE(companion)
  const expected = buf.toString('hex')
  const matched = qualified.filter(
    (p) => p.slice(TOKEN_PLACEHOLDER.length, TOKEN_PLACEHOLDER.length + SLOT_WIDTH * 2) === expected,
  )
  if (matched.length !== 1) {
    throw new Error(
      `bytecode anchor: 合格候选 ${qualified.length} 个，首伴生 == 0x${expected} 者 ${matched.length} 个，应为恰好 1 个`,
    )
  }
  return matched[0]
}

/**
 * 从 signature（源码声明子串，形如 `name=value,name=value,...`）推导语义伴生常量：
 * 主项（值 == sourceTokens）声明之后的首个「异值」整数。同名同值主项可能连续出现
 * 两次（源码中两个 200000 常量，如 `o2e=200000,D6=200000`），故跳过与主项同值的项。
 * 无可推导（主项之后无整数）返回 null，由调用方 fail loud。
 *
 * 隐含假设（5 平台 + 历史全量 anchor 实证，非证明）：Bun 按源码声明序布局常量池并对同值去重，
 * 故池内主项右邻槽 == 声明序中主项之后的首个异值常量。若某版本池序与声明序分叉、且推导值恰
 * 等于某噪声槽首伴生，则「命中恰好 1 个」可能落到噪声槽（静默错选）——此巧合路径无兜底，
 * 无匹配 / 多匹配均已由调用方 fail loud 拦截。
 */
function deriveCompanionTokens(signature: string, sourceTokens: number): number | null {
  const pairs = [...signature.matchAll(/([A-Za-z_$][\w$]*)=(-?\d+)(?![.\deE])/g)]
  const start = pairs.findIndex((m) => Number(m[2]) === sourceTokens)
  if (start === -1) return null
  for (let i = start + 1; i < pairs.length; i++) {
    const value = Number(pairs[i][2])
    if (value !== sourceTokens) return value
  }
  return null
}
