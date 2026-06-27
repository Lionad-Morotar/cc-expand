import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatchApplier } from '../../src/services/patch-applier.js'
import { ConfigService } from '../../src/services/config.js'
import { PackageService } from '../../src/services/package.js'
import { PluginsManager } from '../../src/services/plugins-manager.js'
import { INTERNAL_PLUGINS } from '../../src/internal-plugins.js'
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

  it('远程 pattern 缺失时从本地 binary 做 discovery fallback', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ccx-fallback-'))
    const binaryPath = join(tempDir, 'claude')
    writeFileSync(
      binaryPath,
      [
        'a1b=200000,c=1',
        'd2e=200000,f=2',
        'g3h=200000,i=1536,j=20',
        'k4l=200000,m=50,n=1e4',
        'o5p=200000,q=3,r=2',
        '>200000:!1}'
      ].join('\n')
    )

    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue(undefined)
    } as unknown as ConfigService
    const packageService = {
      isInstalled: () => true,
      getBinaryPath: () => binaryPath
    } as unknown as PackageService

    const prepared = await new PatchApplier().prepare('2.1.195', { configService, packageService })

    expect(prepared.ok).toBe(true)
    if (prepared.ok) {
      expect(prepared.data.patches).toHaveLength(6)
      expect(prepared.data.sourceValue).toBe('200000')
      // discovery 产出的 patch 应带有 desc（由 classifyDesc 生成）
      expect(prepared.data.patches[0].desc).toBeDefined()
      expect(prepared.data.patches.every((p) => p.sourceValue === '200000')).toBe(true)
    }
    expect(configService.getPatternForVersion).toHaveBeenCalledWith('2.1.195')

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('本地 discovery 失败时仍返回 PATTERN_NOT_FOUND', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ccx-fallback-fail-'))
    const binaryPath = join(tempDir, 'claude')
    writeFileSync(binaryPath, 'no anchors here')

    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue(undefined)
    } as unknown as ConfigService
    const packageService = {
      isInstalled: () => true,
      getBinaryPath: () => binaryPath
    } as unknown as PackageService

    const prepared = await new PatchApplier().prepare('2.1.195', { configService, packageService })

    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.error.code).toBe('PATTERN_NOT_FOUND')
    }

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('token-expansion 被禁用且无 installed plugin 时给出清晰错误', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ccx-disabled-'))
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'plugins.json'),
      JSON.stringify({ installed: [], disabledInternal: ['token-expansion'] })
    )

    const pluginsManager = new PluginsManager({
      internalPlugins: INTERNAL_PLUGINS,
      homeDir: tempDir
    })
    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue(undefined)
    } as unknown as ConfigService
    const packageService = { isInstalled: () => true } as unknown as PackageService

    const prepared = await new PatchApplier().prepare('2.1.195', {
      configService,
      packageService,
      pluginsManager
    })

    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.error.code).toBe('PATTERN_NOT_FOUND')
      expect(prepared.error.message).toContain('disabled')
      expect(prepared.error.suggestion).toContain('ccx plugins enable token-expansion')
    }

    rmSync(tempDir, { recursive: true, force: true })
  })
})
