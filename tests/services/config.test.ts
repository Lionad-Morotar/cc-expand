import { describe, it, expect, vi } from 'vitest'
import { ConfigService } from '../../src/services/config.js'
import { PatternService } from '../../src/services/pattern.js'
import type { OsPatterns, VersionsIndexItem } from '../../src/services/pattern.js'

describe('ConfigService', () => {
  describe('getPatternForVersion()', () => {
    it('委托 PatternService 返回匹配 os/arch 的 patch 列表', async () => {
      const mockPattern: OsPatterns = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          ],
        },
      }

      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(mockPattern),
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getPatternForVersion('2.1.173', 'darwin', 'arm64')

      expect(patternService.fetchVersionPattern).toHaveBeenCalledWith('2.1.173')
      expect(result).toEqual([
        { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
      ])
    })

    it('PatternService 返回 undefined 时返回 undefined', async () => {
      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(undefined),
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getPatternForVersion('2.1.999', 'darwin', 'arm64')

      expect(result).toBeUndefined()
    })

    it('arch 不存在时回退到 universal', async () => {
      const mockPattern: OsPatterns = {
        darwin: {
          universal: [
            { search: 'UNI=200000', desc: 'UNIVERSAL', sourceValue: '200000' },
          ],
          x64: [
            { search: 'X64=200000', desc: 'X64_ONLY', sourceValue: '200000' },
          ],
        },
      }

      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(mockPattern),
      } as unknown as PatternService

      const config = new ConfigService({ patternService })

      // x64 存在，直接返回
      const x64Result = await config.getPatternForVersion('2.1.173', 'darwin', 'x64')
      expect(x64Result).toEqual([
        { search: 'X64=200000', desc: 'X64_ONLY', sourceValue: '200000' },
      ])

      // arm64 不存在，回退到 universal
      const arm64Result = await config.getPatternForVersion('2.1.173', 'darwin', 'arm64')
      expect(arm64Result).toEqual([
        { search: 'UNI=200000', desc: 'UNIVERSAL', sourceValue: '200000' },
      ])
    })
  })

  describe('getSupportedVersions()', () => {
    it('返回 PatternService 提供的版本号列表', async () => {
      const mockIndex: VersionsIndexItem[] = [
        { version: '2.1.161', platforms: ['darwin-arm64'] },
        { version: '2.1.173', platforms: ['darwin-arm64', 'darwin-x64'] },
      ]

      const patternService = {
        fetchVersionsIndex: vi.fn().mockResolvedValue(mockIndex),
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getSupportedVersions()

      expect(patternService.fetchVersionsIndex).toHaveBeenCalled()
      expect(result).toEqual(['2.1.161', '2.1.173'])
    })

    it('索引为空时返回空数组', async () => {
      const patternService = {
        fetchVersionsIndex: vi.fn().mockResolvedValue([]),
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getSupportedVersions()

      expect(result).toEqual([])
    })
  })
})
