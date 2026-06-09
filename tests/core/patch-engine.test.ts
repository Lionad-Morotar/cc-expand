import { describe, it, expect } from 'vitest'
import { PatchEngine } from '../../src/core/patch-engine.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

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
      const result = engine.patch(buffer, patches, 256000)

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
      const result = engine.patch(buffer, patches, 256000)

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
      const result = engine.patch(buffer, patches, 300000)

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
      const result = engine.patch(buffer, patches, 256000)

      // Assert
      expect(result.success).toBe(true)
      expect(result.replaceCount).toBe(3)
      expect(result.details).toHaveLength(3)

      const mutatedText = buffer.toString('utf-8')
      expect(mutatedText).toContain('Aj8=256000,Ij_=20000')
      expect(mutatedText).toContain('X93=256000')
      expect(mutatedText).toContain('rt5=256000')
    })
  })
})
