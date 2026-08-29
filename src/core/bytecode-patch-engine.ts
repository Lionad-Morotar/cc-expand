/**
 * bytecode 常量池锚点 patch 引擎
 *
 * Claude Code 2.1.246+ 的 native binary 由 Bun 编译，JS 常量内联在 bytecode
 * 常量池（Kind::Int32 slot 为 4 字节小端明文，见 docs/research/2026-08-28-bun-bytecode-patch.md）。
 * 文本替换只改嵌入源文本、运行时无效；本引擎对 bytecode 侧的字节锚点做替换。
 *
 * 与 PatchEngine 的分工：文本锚点（PatchItem.search）多命中是正常形态（常量在源文本
 * 多处出现），逐处替换；字节锚点命中由编译器常量去重决定，多命中意味着布局漂移、
 * 无法确定目标是常量池还是巧合数据，因此唯一性是硬约束——多命中直接拒绝。
 */
export interface BytecodePatchInput {
  /** hex 编码的字节锚点序列；{{tokens}} 占位符标记源值槽位（4 字节，搜索时填源值、写入时换目标值） */
  bytecodePatterns: string[]
  /** 目标 tokens 数值（写入占位符位置） */
  targetTokens: number
  /** 源 tokens 数值（未 patch binary 中占位符处的现值，搜索锚点用） */
  sourceTokens: number
}

export interface BytecodePatchDetail {
  /** 命中的锚点索引（bytecodePatterns 下标） */
  anchorIndex: number
  /** 替换发生在 binary 中的绝对偏移 */
  offset: number
}

export type BytecodePatchResult = {
  success: true
  replaceCount: number
  details: BytecodePatchDetail[]
  /** 无锚点配置时 true（pre-bytecode binary，如 2.1.245-） */
  skipped: boolean
} | {
  success: false
  replaceCount: 0
  details: []
  error: { code: string, message: string, suggestion?: string }
}

const TOKEN_PLACEHOLDER = '{{tokens}}'
/** 占位符对应 4 字节 Int32 slot 宽度（bytecode 常量池 Kind::Int32 slot） */
const SLOT_WIDTH = 4

/**
 * 解析锚点 hex：支持 {{tokens}} 占位符（占 4 字节，位置任意）；返回 null 表示非法 hex。
 * 占位符处由调用方决定填充：patch 搜索填源值（定位未 patch 槽位）、verify 搜索填目标值。
 */
function parseAnchor(pattern: string, slotBytes: Buffer): { bytes: Buffer, tokenAt: number } | null {
  const placeholderPos = pattern.indexOf(TOKEN_PLACEHOLDER)
  let hex: string
  let tokenAt: number
  if (placeholderPos !== -1) {
    hex = pattern.slice(0, placeholderPos) + '00000000' + pattern.slice(placeholderPos + TOKEN_PLACEHOLDER.length)
    tokenAt = placeholderPos / 2
    if (!Number.isInteger(tokenAt)) return null
  } else {
    hex = pattern
    tokenAt = -1
  }
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  if (tokenAt !== -1 && tokenAt % SLOT_WIDTH !== 0) return null
  const bytes = Buffer.from(hex, 'hex')
  if (tokenAt !== -1) slotBytes.copy(bytes, tokenAt)
  return { bytes, tokenAt }
}

export class BytecodePatchEngine {
  /**
   * 在 binary 缓冲区中按字节锚点定位并替换常量池 Int32 值。
   * 每个锚点必须恰好命中 1 次（0 或 ≥2 次均失败）；替换只发生在含
   * {{tokens}} 占位符的锚点上（搜索填源值、写入换目标值），无占位符的
   * 锚点仅作唯一性确认（AND 语义）。任一锚点失败则整体失败且 buffer
   * 不被修改（原子性）。patch 总是基于原始 binary 的拷贝执行——已 patch
   * 的槽位源值已消失，锚点不命中即拒绝，不做幂等重放。
   * resolveTokenBytes 注入非默认编码（默认 UInt32LE），保持内核零 token 知识。
   */
  patch(
    buffer: Buffer,
    input: BytecodePatchInput,
    resolveTokenBytes: (tokens: number) => Buffer = (tokens) => {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(tokens)
      return b
    }
  ): BytecodePatchResult {
    const { bytecodePatterns, targetTokens, sourceTokens } = input
    if (!bytecodePatterns?.length) {
      return { success: true, replaceCount: 0, details: [], skipped: true }
    }

    // 先全量解析 + 计数，全部通过才动 buffer（原子性）。
    // 搜索字节与替换字节分源：搜索用源值（定位原始槽位），写入用目标值。
    const sourceBytes = resolveTokenBytes(sourceTokens)
    const targetBytes = resolveTokenBytes(targetTokens)
    const anchors: Array<{ bytes: Buffer, tokenAt: number, hits: number[] }> = []
    for (const pattern of bytecodePatterns) {
      const parsed = parseAnchor(pattern, sourceBytes)
      if (!parsed) {
        return {
          success: false,
          replaceCount: 0,
          details: [],
          error: {
            code: 'INVALID_TARGET',
            message: `Malformed bytecode pattern: ${pattern.slice(0, 64)}`
          }
        }
      }
      const hits: number[] = []
      let offset = 0
      while (true) {
        const idx = buffer.indexOf(parsed.bytes, offset)
        if (idx === -1) break
        hits.push(idx)
        offset = idx + 1
      }
      if (hits.length !== 1) {
        return {
          success: false,
          replaceCount: 0,
          details: [],
          error: hits.length === 0
            ? {
                code: 'PATTERN_NOT_FOUND',
                message: 'Bytecode anchor not found in binary — constant pool layout may have changed',
                suggestion: 'Regenerate the pattern for this version or report to cc-expand'
              }
            : {
                code: 'AMBIGUOUS_PATTERN',
                message: `Bytecode anchor matched ${hits.length} times — refusing to patch ambiguous target`,
                suggestion: 'Regenerate the pattern for this version or report to cc-expand'
              }
        }
      }
      anchors.push({ ...parsed, hits })
    }

    const details: BytecodePatchDetail[] = []
    anchors.forEach((anchor, anchorIndex) => {
      // 无占位符 = 确认型锚点（仅唯一性校验，不改字节）；有占位符 = 写入目标值
      if (anchor.tokenAt === -1) return
      targetBytes.copy(buffer, anchor.hits[0] + anchor.tokenAt)
      details.push({ anchorIndex, offset: anchor.hits[0] + anchor.tokenAt })
    })

    return { success: true, replaceCount: details.length, details, skipped: false }
  }

  /**
   * patch 后验证：每个锚点（占位符填目标值）在 binary 中恰好命中 1 次。
   * 与 patch() 对称——patch 用源值定位、写入目标值，verify 用目标值回查；
   * 未 patch 或错改的 binary 不命中目标槽位，验证失败。
   * resolveTokenBytes 语义与 patch() 相同（保持两侧编码一致）。
   */
  verify(
    buffer: Buffer,
    input: BytecodePatchInput,
    resolveTokenBytes: (tokens: number) => Buffer = (tokens) => {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(tokens)
      return b
    }
  ): BytecodePatchResult {
    const { bytecodePatterns, targetTokens } = input
    if (!bytecodePatterns?.length) {
      return { success: true, replaceCount: 0, details: [], skipped: true }
    }

    const targetBytes = resolveTokenBytes(targetTokens)
    for (const pattern of bytecodePatterns) {
      const parsed = parseAnchor(pattern, targetBytes)
      if (!parsed) {
        return {
          success: false,
          replaceCount: 0,
          details: [],
          error: { code: 'INVALID_TARGET', message: `Malformed bytecode pattern: ${pattern.slice(0, 64)}` }
        }
      }
      const hits: number[] = []
      let offset = 0
      while (true) {
        const idx = buffer.indexOf(parsed.bytes, offset)
        if (idx === -1) break
        hits.push(idx)
        offset = idx + 1
      }
      if (hits.length !== 1) {
        return {
          success: false,
          replaceCount: 0,
          details: [],
          error: hits.length === 0
            ? {
                code: 'PATTERN_NOT_FOUND',
                message: 'Bytecode anchor not found — patch may have failed or binary layout changed',
                suggestion: 'Run "cc-expand restore" to revert and report to cc-expand'
              }
            : {
                code: 'AMBIGUOUS_PATTERN',
                message: `Bytecode anchor matched ${hits.length} times during verification`,
                suggestion: 'Run "cc-expand restore" to revert and report to cc-expand'
              }
        }
      }
    }
    return { success: true, replaceCount: 0, details: [], skipped: false }
  }
}
