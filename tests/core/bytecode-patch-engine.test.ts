import { describe, it, expect } from 'vitest'
import { BytecodePatchEngine } from '../../src/core/bytecode-patch-engine.js'
import { ErrorCode } from '../../src/types/index.js'

/** 实证锚点（2.1.250 darwin/arm64）：常量池四连 Int32 LE —— 200000, 32000, 128000, 1000000。
 *  {{tokens}} 占位首槽（200000 即 context window 常量 vGe/UN）。 */
const ANCHOR_HEX = '{{tokens}}007d0000 00f40100 40420f00'.replace(/\s/g, '')
const TARGET_TOKENS = 280000
const SOURCE_TOKENS = 200000

/** 构造含源值槽位的锚点字节段（模拟未 patch binary 的常量池布局） */
const anchorSegment = () => Buffer.concat([
  (() => { const b = Buffer.alloc(4); b.writeUInt32LE(SOURCE_TOKENS); return b })(),
  Buffer.from('007d0000 00f40100 40420f00'.replace(/\s/g, ''), 'hex')
])

describe('BytecodePatchEngine', () => {
  describe('patch()', () => {
    it('should replace the Int32 constant when the anchor matches uniquely (tracer bullet)', () => {
      // Arrange: synthetic binary — 锚点出现 1 次，前面有些无关字节
      const buffer = Buffer.concat([Buffer.from([0xde, 0xad, 0xbe, 0xef]), anchorSegment(), Buffer.alloc(16, 0)])

      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      // Assert: 唯一命中 + 替换成功 + buffer 实际被改写 + 邻居不受影响
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(1)
      expect(result.details[0].offset).toBe(4)
      expect(buffer.subarray(4, 8).readUInt32LE(0)).toBe(TARGET_TOKENS)
      expect(buffer.subarray(8, 12).readUInt32LE(0)).toBe(32000)
    })

    it('should fail with PATTERN_NOT_FOUND when anchor is absent', () => {
      const buffer = Buffer.alloc(64, 0)
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
      expect(buffer.subarray(0, 4).readUInt32LE(0)).toBe(0) // 原子性：buffer 未被修改
    })

    it('should refuse re-patching an already-patched binary (source slot gone)', () => {
      // 已 patch 过的 binary：首槽已是目标值，锚点按源值搜索不命中 → 拒绝而非错改
      const buffer = Buffer.concat([
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(TARGET_TOKENS); return b })(),
        Buffer.from('007d0000 00f40100 40420f00'.replace(/\s/g, ''), 'hex')
      ])
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
      expect(buffer.subarray(0, 4).readUInt32LE(0)).toBe(TARGET_TOKENS) // 原值未被破坏
    })

    it('should fail with AMBIGUOUS_PATTERN when anchor matches more than once', () => {
      const buffer = Buffer.concat([anchorSegment(), Buffer.alloc(8, 0), anchorSegment()])
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.AMBIGUOUS_PATTERN)
    })

    it('should support multiple placeholder anchors, all must match (AND semantics)', () => {
      // 双锚点都含占位符且源值同源（引擎语义：单一 sourceTokens/targetTokens 对全锚点共用），
      // 两个都必须唯一命中并各自替换
      const secondary = Buffer.concat([
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(SOURCE_TOKENS); return b })(),
        Buffer.from('0000c23c0300', 'hex')
      ])
      const buffer = Buffer.concat([anchorSegment(), Buffer.alloc(4, 0), secondary])

      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, {
        bytecodePatterns: [ANCHOR_HEX, '{{tokens}}0000c23c0300'],
        targetTokens: TARGET_TOKENS,
        sourceTokens: SOURCE_TOKENS
      })

      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(2)
      // secondary 已被替换（源值消失），改用锚点尾部字节定位再回退 4 字节取槽位
      const secAt = buffer.indexOf(Buffer.from('0000c23c0300', 'hex')) - 4
      expect(buffer.subarray(secAt, secAt + 4).readUInt32LE(0)).toBe(TARGET_TOKENS)
    })

    it('should treat anchor without placeholder as confirmation-only (no replacement)', () => {
      // 无占位符锚点 = 确认型：只校验唯一命中，不改字节
      const confirmBytes = Buffer.from('abcdef0100', 'hex')
      const buffer = Buffer.concat([anchorSegment(), Buffer.alloc(2, 0), confirmBytes, Buffer.alloc(4, 0)])

      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, {
        bytecodePatterns: [ANCHOR_HEX, 'abcdef0100'],
        targetTokens: TARGET_TOKENS,
        sourceTokens: SOURCE_TOKENS
      })

      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(1) // 只替换占位锚点
      const confirmAt = buffer.indexOf(confirmBytes)
      expect([...buffer.subarray(confirmAt, confirmAt + 5)]).toEqual([...confirmBytes]) // 未被改
    })

    it('should fail when one of multiple anchors is absent', () => {
      const buffer = Buffer.from(anchorSegment())
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, {
        bytecodePatterns: [ANCHOR_HEX, 'ffffffffffffffff'],
        targetTokens: TARGET_TOKENS,
        sourceTokens: SOURCE_TOKENS
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
    })

    it('should reject malformed hex pattern', () => {
      const buffer = Buffer.alloc(32, 0)
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: ['zzzz'], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.INVALID_TARGET)
    })

    it('should skip when no bytecodePatterns configured (pre-bytecode binary)', () => {
      const buffer = Buffer.from('anything')
      const engine = new BytecodePatchEngine()
      const result = engine.patch(buffer, { bytecodePatterns: [], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(0)
      expect(result.skipped).toBe(true)
    })

    it('should accept a resolveTokenBytes callback for non-default token encodings', () => {
      // 编码注入生效证明：BE 编码下搜索字节与 LE 布局不匹配 → 锚点不命中（编码确实被注入使用）
      const buffer = Buffer.concat([anchorSegment(), Buffer.alloc(4, 0)])
      const engine = new BytecodePatchEngine()
      const result = engine.patch(
        buffer,
        { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS },
        (t: number) => {
          const b = Buffer.alloc(4)
          b.writeUInt32BE(t)
          return b
        }
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
    })
  })

  describe('verify()', () => {
    it('should pass when patched binary has each anchor (target-filled) matching exactly once', () => {
      // Arrange: 模拟已 patch 的 binary（首槽 = 目标值）
      const buffer = Buffer.concat([
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(TARGET_TOKENS); return b })(),
        Buffer.from('007d0000 00f40100 40420f00'.replace(/\s/g, ''), 'hex'),
        Buffer.alloc(8, 0)
      ])
      const engine = new BytecodePatchEngine()

      const result = engine.verify(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(true)
    })

    it('should fail verification on an unpatched binary (target slot absent)', () => {
      // 未 patch 的 binary：槽位仍是源值，按目标值搜索不命中 → 验证失败（堵住「报告成功实际无效」）
      const buffer = Buffer.from(anchorSegment())
      const engine = new BytecodePatchEngine()

      const result = engine.verify(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
    })

    it('should verify confirmation-only anchors without placeholder', () => {
      // 确认型锚点（无占位符）patch 前后字节不变，verify 同样要求唯一命中
      const confirmHex = 'abcdef0100'
      const buffer = Buffer.concat([anchorSegment(), confirmHex && Buffer.from(confirmHex, 'hex')])
      const engine = new BytecodePatchEngine()

      const result = engine.verify(buffer, { bytecodePatterns: [confirmHex], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(true)
    })

    it('should fail when verified anchor matches more than once', () => {
      const mkTarget = () => Buffer.concat([
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(TARGET_TOKENS); return b })(),
        Buffer.from('007d0000 00f40100 40420f00'.replace(/\s/g, ''), 'hex')
      ])
      const buffer = Buffer.concat([mkTarget(), Buffer.alloc(4, 0), mkTarget()])
      const engine = new BytecodePatchEngine()

      const result = engine.verify(buffer, { bytecodePatterns: [ANCHOR_HEX], targetTokens: TARGET_TOKENS, sourceTokens: SOURCE_TOKENS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.AMBIGUOUS_PATTERN)
    })
  })
})
