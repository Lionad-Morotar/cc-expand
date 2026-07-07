import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Verifier } from '../../src/core/verifier.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'
import { encodeTokenLiteral } from '../../src/utils/encode-token-literal.js'

/** 构造 token-encode generator（与生产 patch-applier 等价） */
const tokenGen = (tokens: number) => (slot: number) => encodeTokenLiteral(tokens, slot)

describe('Verifier', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-verify-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('verify()', () => {
    it('should pass when all checks succeed', async () => {
      // Arrange: create a fake binary with the expected pattern
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=256000,Ij_=20000_X93=256000')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()

      // Act
      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(256000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' }
        ]
      })

      // Assert
      expect(result.success).toBe(true)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: true })
      )
    })

    it('should fail when expected pattern not found', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=200000,Ij_=20000_X93=200000')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(256000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' }
        ]
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.VERIFICATION_FAILED)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: false })
      )
    })

    it('should fail when original pattern still present', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=200000,Ij_=20000_X93=200000')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(256000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' }
        ]
      })

      expect(result.success).toBe(false)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: false })
      )
    })

    it('should fail when binary is not executable', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=256000,Ij_=20000')
      // No chmod - file is not executable

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(256000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' }
        ]
      })

      expect(result.success).toBe(false)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'executable', passed: false })
      )
    })

    it('should pass when a 7-digit target is encoded as a shorter literal', async () => {
      // patch 到 1000000 时写入的是等长编码字面量 "1e6   "（非十进制 "1000000"）
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=1e6   ,Ij_=20000_X93=1e6   ')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()
      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(1000000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' }
        ]
      })

      expect(result.success).toBe(true)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: true })
      )
    })

    it('should verify per-slot when patches have different sourceValue widths', async () => {
      // 6 位槽 200000 → encode(1000000,6)="1e6   "(6B)；5 位槽 32000 → encode(1000000,5)="1e6  "(5B)
      // 不同槽位宽度产出不同编码字面量，Verifier 须逐项校验而非用单一 slotWidth
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'A=1e6   ,_B=1e6  ,_')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()
      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(1000000),
        sourceValue: '200000',
        patches: [
          { search: 'A=200000,', desc: 'six-byte-slot', sourceValue: '200000' },
          { search: 'B=32000,', desc: 'five-byte-slot', sourceValue: '32000' }
        ]
      })

      expect(result.success).toBe(true)
    })

    it('should verify literal-target patches (installed plugin) without false failure (flow CR#8)', async () => {
      // installed plugin 的 literal patch：sourceValue 是 30B 槽位，target.value 短 + pad:right-space 凑等长。
      // 旧 verifier 对所有 patch 统一 encodeTokenLiteral 生成期望值，literal patch 会被误判 → binary 误删。
      const slot = 'A'.repeat(30)
      const literalValue = 'process.env.X?"":y' // 17B
      const padded = literalValue.padEnd(30, ' ')
      const binaryPath = join(tempDir, 'claude')
      // token 槽 200000→256000；literal 槽 slot→padded
      writeFileSync(binaryPath, 'Aj8=256000,Ij_=20000___' + padded)
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()
      const result = await verifier.verify({
        binaryPath,
        targetGenerator: tokenGen(256000),
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'token', sourceValue: '200000' },
          { search: slot, desc: 'cc-flow', sourceValue: slot, target: { value: literalValue, pad: 'right-space' } }
        ]
      })

      expect(result.success).toBe(true)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: true })
      )
    })
  })
})
