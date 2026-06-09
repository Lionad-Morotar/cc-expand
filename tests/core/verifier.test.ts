import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Verifier } from '../../src/core/verifier.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

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
        targetTokens: 256000,
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' },
        ],
      })

      // Assert
      expect(result.success).toBe(true)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: true }),
      )
    })

    it('should fail when expected pattern not found', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=200000,Ij_=20000_X93=200000')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetTokens: 256000,
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.VERIFICATION_FAILED)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: false }),
      )
    })

    it('should fail when original pattern still present', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=200000,Ij_=20000_X93=200000')
      chmodSync(binaryPath, 0o755)

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetTokens: 256000,
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          { search: 'X93=200000', desc: 'teamMemorySync', sourceValue: '200000' },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'pattern-replaced', passed: false }),
      )
    })

    it('should fail when binary is not executable', async () => {
      const binaryPath = join(tempDir, 'claude')
      writeFileSync(binaryPath, 'Aj8=256000,Ij_=20000')
      // No chmod - file is not executable

      const verifier = new Verifier()

      const result = await verifier.verify({
        binaryPath,
        targetTokens: 256000,
        sourceValue: '200000',
        patches: [
          { search: 'Aj8=200000,Ij_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: 'executable', passed: false }),
      )
    })
  })
})
