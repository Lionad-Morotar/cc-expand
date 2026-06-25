import { describe, it, expect, vi } from 'vitest'
import { PatchApplier } from '../../src/services/patch-applier.js'
import { ConfigService } from '../../src/services/config.js'
import { PackageService } from '../../src/services/package.js'
import type { PatchItem } from '../../src/types/index.js'

describe('PatchApplier.prepare() plugin 聚合', () => {
  it('合并 token patches + installed plugin patches（literal target）', async () => {
    const tokenPatches: PatchItem[] = [
      { search: 'Aj8=200000', desc: 'token', sourceValue: '200000' },
    ]
    const installedPatches: PatchItem[] = [
      { search: 'AAA', sourceValue: 'AAA', target: { value: 'BBB' } },
    ]
    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue(tokenPatches),
    } as unknown as ConfigService
    const packageService = {
      isInstalled: () => true,
    } as unknown as PackageService

    const applier = new PatchApplier()
    const prepared = await applier.prepare('2.1.186', {
      configService,
      packageService,
      installedPatches,
    })

    expect(prepared.ok).toBe(true)
    if (prepared.ok) {
      expect(prepared.data.patches).toHaveLength(2)
      // token 在前，installed 在后
      expect(prepared.data.patches[0].sourceValue).toBe('200000')
      expect(prepared.data.patches[1].target?.value).toBe('BBB')
      // sourceValue 仍取 token 第一个（binary 命名/校验基准）
      expect(prepared.data.sourceValue).toBe('200000')
    }
  })

  it('无 installedPatches 时只 token（向后兼容）', async () => {
    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue([{ search: 'X', sourceValue: '200000' }]),
    } as unknown as ConfigService
    const packageService = { isInstalled: () => true } as unknown as PackageService

    const prepared = await new PatchApplier().prepare('2.1.186', { configService, packageService })
    expect(prepared.ok).toBe(true)
    if (prepared.ok) {
      expect(prepared.data.patches).toHaveLength(1)
    }
  })
})
