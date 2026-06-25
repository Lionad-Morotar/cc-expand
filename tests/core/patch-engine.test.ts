import { describe, it, expect } from 'vitest'
import { PatchEngine } from '../../src/core/patch-engine.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'
import { encodeTokenLiteral } from '../../src/utils/encode-token-literal.js'

/** 构造 token-encode generator（与生产 patch-applier 等价）：slot → 等长字面量 */
const tokenGen = (tokens: number) => (slot: number) => encodeTokenLiteral(tokens, slot)

describe('PatchEngine', () => {
  describe('patch()', () => {
    it('should replace the constant string in a mock binary', () => {
      // Arrange: create a mock binary buffer with the default constant
      const buffer = Buffer.from('some_binary_header_Aj8=200000,Ij_=20000_trailer_data')

      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ]

      // Act
      const result = engine.patch(buffer, patches, tokenGen(256000))

      // Assert: result indicates success
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(1)
      expect(result.details).toHaveLength(1)
      expect(result.details[0].desc).toBe('MODEL_CONTEXT_WINDOW_DEFAULT')

      // Assert: the buffer content was actually mutated
      const mutatedText = buffer.toString('utf-8')
      expect(mutatedText).toContain('Aj8=256000,Ij_=20000')
      expect(mutatedText).not.toContain('Aj8=200000,Ij_=20000')
    })

    it('should return error when pattern not found', () => {
      // Arrange: buffer without the expected pattern
      const buffer = Buffer.from('some_random_data_without_the_constant')
      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ]

      // Act
      const result = engine.patch(buffer, patches, tokenGen(256000))

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(CcxError)
      expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)
    })

    it('should replace multiple occurrences', () => {
      // Arrange: buffer with multiple occurrences of the pattern
      const buffer = Buffer.from(
        'Aj8=200000,Ij_=20000_junk_Aj8=200000,Ij_=20000_junk_Aj8=200000,Ij_=20000',
      )

      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ]

      // Act
      const result = engine.patch(buffer, patches, tokenGen(300000))

      // Assert
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(3)
      expect(result.details).toHaveLength(3)
      const mutatedText = buffer.toString('utf-8')
      expect(mutatedText).not.toContain('Aj8=200000')
      expect(mutatedText.split('Aj8=300000').length - 1).toBe(3)
    })

    it('should patch multiple different patterns', () => {
      // Arrange: buffer with multiple different patterns
      const buffer = Buffer.from(
        'Aj8=200000,Ij_=20000_X93=200000_rt5=200000',
      )

      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
        { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' },
        { search: 'rt5=200000', desc: 'skill tool budget', sourceValue: '200000' },
      ]

      // Act
      const result = engine.patch(buffer, patches, tokenGen(256000))

      // Assert
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(3)
      expect(result.details).toHaveLength(3)

      const mutatedText = buffer.toString('utf-8')
      expect(mutatedText).toContain('Aj8=256000,Ij_=20000')
      expect(mutatedText).toContain('X93=256000')
      expect(mutatedText).toContain('rt5=256000')
    })

    it('patches a 7-digit target using an equal-length encoded literal', () => {
      // 回归：7 位目标（1000000）过去会让 buffer.write 吃掉相邻逗号、破坏 minified JS。
      // 现在用 "1e6   "(6B, =1000000) 等长编码，逗号完好，文件长度不变（Mach-O 约束）。
      const buffer = Buffer.from('header_Aj8=200000,Ij_=20000_trailer')
      const originalLength = buffer.length
      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ]

      const result = engine.patch(buffer, patches, tokenGen(1000000))

      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(1)
      const mutatedText = buffer.toString('utf-8')
      expect(mutatedText).toContain('Aj8=1e6   ,Ij_=20000')
      expect(mutatedText).not.toContain('200000')
      expect(buffer.length).toBe(originalLength)
    })

    it('returns a failure result without mutating the buffer when the target is unencodable', () => {
      const buffer = Buffer.from('header_Aj8=200000,Ij_=20000_trailer')
      const originalLength = buffer.length
      const engine = new PatchEngine()
      const patches = [
        { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ]
      // 1234567: 十进制7位 / 1.234567e6=10位 / 0x12d687=8位，均超 6 字节槽位
      const result = engine.patch(buffer, patches, tokenGen(1234567))

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(CcxError)
      expect(result.error?.code).toBe(ErrorCode.INVALID_TARGET)
      // 原子性：失败时 buffer 不被修改
      expect(buffer.length).toBe(originalLength)
      expect(buffer.toString('utf-8')).toContain('Aj8=200000')
    })

    it('patches using literal target (equal-length value, no token-encode)', () => {
      // installed plugin 风格：固定字节替换，不依赖 targetTokens
      const buffer = Buffer.from('header_PLACEHOLDER_trailer')
      const engine = new PatchEngine()
      const patches = [
        { search: 'PLACEHOLDER', sourceValue: 'PLACEHOLDER', target: { value: 'PATCHED!!!!' } },
      ]
      const result = engine.patch(buffer, patches, tokenGen(0))
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(1)
      const mutated = buffer.toString('utf-8')
      expect(mutated).toContain('PATCHED!!!!')
      expect(mutated).not.toContain('PLACEHOLDER')
    })

    it('patches literal target with pad:"right-space" (cc-flow 风格：短表达式 + pad)', () => {
      // 模拟 cc-flow：大槽位（sourceValue 20B）+ 短 target value + right-space pad 到等长
      const slot = 'A'.repeat(20)
      const buffer = Buffer.from('x' + slot + 'y')
      const originalLength = buffer.length
      const engine = new PatchEngine()
      const patches = [{
        search: slot,
        sourceValue: slot,
        target: { value: 'env?x:y', pad: 'right-space' as const },
      }]
      const result = engine.patch(buffer, patches, tokenGen(0))
      expect(result.success).toBe(true)
      const mutated = buffer.toString('utf-8')
      expect(mutated).toContain('env?x:y')
      // 'env?x:y' (7B) + 13 空格 = 20B 等长
      expect(mutated).toMatch(/env\?x:y {13}/)
      expect(buffer.length).toBe(originalLength)
    })

    it('rejects literal target longer than slot (INVALID_TARGET, atomic)', () => {
      const buffer = Buffer.from('header_SHORT_trailer')
      const originalLength = buffer.length
      const engine = new PatchEngine()
      const patches = [{
        search: 'SHORT',
        sourceValue: 'SHORT',
        target: { value: 'TOO_LONG_VALUE' },
      }]
      const result = engine.patch(buffer, patches, tokenGen(0))
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.INVALID_TARGET)
      // 原子性：buffer 不变
      expect(buffer.length).toBe(originalLength)
      expect(buffer.toString('utf-8')).toContain('SHORT')
    })

    it('uses injected targetGenerator when provided (overrides default encode)', () => {
      // ADR 0003 内核零 token 知识：generator 注入路径，绕过 encodeTokenLiteral
      const buffer = Buffer.from('header_Aj8=200000,Ij_=20000_trailer')
      const engine = new PatchEngine()
      const patches = [{ search: 'Aj8=200000,Ij_=20000', sourceValue: '200000', desc: 'token' }]
      // 注入 generator：返回等长自定义值（验证注入，不调 encodeTokenLiteral）
      const result = engine.patch(buffer, patches, (slot) => 'XX'.padEnd(slot, ' '))
      expect(result.success).toBe(true)
      const mutated = buffer.toString('utf-8')
      expect(mutated).toContain('XX')
      expect(mutated).not.toContain('200000')
    })
  })
})
