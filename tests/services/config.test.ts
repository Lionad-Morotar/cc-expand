import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigService } from '../../src/services/config.js'
import type { PatternService, OsPatterns, VersionsIndexItem } from '../../src/services/pattern.js'

describe('ConfigService', () => {
  describe('getPatternForVersion()', () => {
    it('委托 PatternService 返回匹配 os/arch 的 patch 列表', async () => {
      const mockPattern: OsPatterns = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' }
          ]
        }
      }

      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(mockPattern)
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getPatternForVersion('2.1.173', 'darwin', 'arm64')

      expect(patternService.fetchVersionPattern).toHaveBeenCalledWith('2.1.173')
      expect(result).toEqual([
        { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' }
      ])
    })

    it('PatternService 返回 undefined 时返回 undefined', async () => {
      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(undefined)
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getPatternForVersion('2.1.999', 'darwin', 'arm64')

      expect(result).toBeUndefined()
    })

    it('arch 不存在时回退到 universal', async () => {
      const mockPattern: OsPatterns = {
        darwin: {
          universal: [
            { search: 'UNI=200000', desc: 'UNIVERSAL', sourceValue: '200000' }
          ],
          x64: [
            { search: 'X64=200000', desc: 'X64_ONLY', sourceValue: '200000' }
          ]
        }
      }

      const patternService = {
        fetchVersionPattern: vi.fn().mockResolvedValue(mockPattern)
      } as unknown as PatternService

      const config = new ConfigService({ patternService })

      // x64 存在，直接返回
      const x64Result = await config.getPatternForVersion('2.1.173', 'darwin', 'x64')
      expect(x64Result).toEqual([
        { search: 'X64=200000', desc: 'X64_ONLY', sourceValue: '200000' }
      ])

      // arm64 不存在，回退到 universal
      const arm64Result = await config.getPatternForVersion('2.1.173', 'darwin', 'arm64')
      expect(arm64Result).toEqual([
        { search: 'UNI=200000', desc: 'UNIVERSAL', sourceValue: '200000' }
      ])
    })
  })

  describe('getSupportedVersions()', () => {
    it('返回 PatternService 提供的版本号列表', async () => {
      const mockIndex: VersionsIndexItem[] = [
        { version: '2.1.161', platforms: ['darwin-arm64'] },
        { version: '2.1.173', platforms: ['darwin-arm64', 'darwin-x64'] }
      ]

      const patternService = {
        fetchVersionsIndex: vi.fn().mockResolvedValue(mockIndex)
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getSupportedVersions()

      expect(patternService.fetchVersionsIndex).toHaveBeenCalled()
      expect(result).toEqual(['2.1.161', '2.1.173'])
    })

    it('索引为空时返回空数组', async () => {
      const patternService = {
        fetchVersionsIndex: vi.fn().mockResolvedValue([])
      } as unknown as PatternService

      const config = new ConfigService({ patternService })
      const result = await config.getSupportedVersions()

      expect(result).toEqual([])
    })
  })

  describe('combos schema (plugin 体系迁移)', () => {
    function newConfig() {
      const homeDir = mkdtempSync(join(tmpdir(), 'ccx-cfg-'))
      return new ConfigService({ homeDir })
    }

    it('recordPatchedCombo writes combos (idempotent)', () => {
      const config = newConfig()
      config.recordPatchedCombo('2.1.186', '27w-flow')
      config.recordPatchedCombo('2.1.186', '27w-flow') // 幂等
      expect(config.getUserConfig().patchedVersions['2.1.186']?.combos).toEqual(['27w-flow'])
    })

    it('migrates legacy targets → combos via formatTokenCount (targets retained)', () => {
      const config = newConfig()
      config.setUserConfig({
        patchedVersions: { '2.1.186': { targets: [270000, 1000000], patchedAt: '2026-06-24' } }
      })
      const migrated = config.getUserConfig()
      expect(migrated.patchedVersions['2.1.186']?.combos).toEqual(['27w', '1m'])
      // targets 保留（status/list 兼容）
      expect(migrated.patchedVersions['2.1.186']?.targets).toEqual([270000, 1000000])
    })

    it('does not overwrite existing combos when targets also present', () => {
      const config = newConfig()
      config.setUserConfig({
        patchedVersions: { '2.1.186': { targets: [270000], combos: ['custom'], patchedAt: 'x' } }
      })
      // 已有 combos，不迁移覆盖
      expect(config.getUserConfig().patchedVersions['2.1.186']?.combos).toEqual(['custom'])
    })
  })

  describe('removePatchedCombo', () => {
    function newConfig() {
      const homeDir = mkdtempSync(join(tmpdir(), 'ccx-cfg-remove-'))
      return new ConfigService({ homeDir })
    }

    it('removes an existing combo', () => {
      const config = newConfig()
      config.recordPatchedCombo('2.1.186', '27w')
      config.recordPatchedCombo('2.1.186', '27w-flow')

      const removed = config.removePatchedCombo('2.1.186', '27w')

      expect(removed).toBe(true)
      expect(config.getUserConfig().patchedVersions['2.1.186']?.combos).toEqual(['27w-flow'])
    })

    it('returns false when combo does not exist', () => {
      const config = newConfig()
      config.recordPatchedCombo('2.1.186', '27w')

      const removed = config.removePatchedCombo('2.1.186', 'missing')

      expect(removed).toBe(false)
      expect(config.getUserConfig().patchedVersions['2.1.186']?.combos).toEqual(['27w'])
    })

    it('removes the whole version entry when last combo is removed', () => {
      const config = newConfig()
      config.recordPatchedCombo('2.1.186', '27w')

      config.removePatchedCombo('2.1.186', '27w')

      expect(config.getUserConfig().patchedVersions['2.1.186']).toBeUndefined()
    })

    it('returns false when combo does not exist (even after targets migration)', () => {
      const config = newConfig()
      config.setUserConfig({
        patchedVersions: { '2.1.186': { targets: [270000], patchedAt: 'x' } }
      })

      const removed = config.removePatchedCombo('2.1.186', '1m')

      expect(removed).toBe(false)
    })
  })

  describe('removePatchedVersion', () => {
    function newConfig() {
      const homeDir = mkdtempSync(join(tmpdir(), 'ccx-cfg-remove-version-'))
      return new ConfigService({ homeDir })
    }

    it('removes the whole version entry', () => {
      const config = newConfig()
      config.recordPatchedCombo('2.1.186', '27w')
      config.recordPatchedCombo('2.1.186', '27w-flow')

      const removed = config.removePatchedVersion('2.1.186')

      expect(removed).toBe(true)
      expect(config.getUserConfig().patchedVersions['2.1.186']).toBeUndefined()
    })

    it('returns false when version does not exist', () => {
      const config = newConfig()
      const removed = config.removePatchedVersion('2.1.186')
      expect(removed).toBe(false)
    })
  })
})
