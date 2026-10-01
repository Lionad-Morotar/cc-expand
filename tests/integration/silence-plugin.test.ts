import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginsManager } from '../../src/services/plugins-manager.js'
import { collectPluginContext } from '../../src/services/plugin-patches.js'
import { PatchApplier } from '../../src/services/patch-applier.js'
import type { ConfigService } from '../../src/services/config.js'
import type { PackageService } from '../../src/services/package.js'
import type { OsPatterns } from '../../src/services/pattern.js'
import type { InternalPluginDefinition, PluginManifest } from '../../src/types/plugins.js'

/**
 * silence-unrecognized-model 插件端到端：manifest 注册 → shard 装载（stub fetch）→
 * literal patch 执行 → 产物 binary 字节断言。锚与槽位取自 v2.1.285 真实 shard
 * （含 >=0x80 高位字节，经 JSON \u00XX 转义进来，兼作引擎 latin1 链路的集成实证）
 */
const ANCHOR_BEFORE = '"\u0085R\u0007\u0011\u0006j\u0012'
const ANCHOR_AFTER = '"\u0085R\u0007\u0011\u0004j\u0012'

const silenceManifest: PluginManifest = {
  name: 'silence-unrecognized-model',
  shardBaseUrl: 'https://cc-expand.oss-cn-shanghai.aliyuncs.com/plugins/silence-unrecognized-model/',
  shortVer: { kind: 'literal', value: 'sil' },
  description: 'test fixture'
}

/** 与生成器产出的 shard 同构（纯 PatchItem 契约字段，无发现器内部字段）。
 *  平台/架构键按当前主机自适应：collectPluginContext 按 process.platform/arch 取档 */
const silenceShard: OsPatterns = {
  [process.platform]: {
    [process.arch]: [{
      search: ANCHOR_BEFORE,
      sourceValue: '\u0006',
      target: { value: '\u0004' },
      desc: 'silence-unrecognized-model guard'
    }]
  }
}

describe('silence plugin 端到端', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shard 装载 → literal patch → 产物 binary 字节断言 → claude-sil 命名', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => silenceShard,
      headers: { get: () => 'etag-x' }
    }))

    const homeDir = mkdtempSync(join(tmpdir(), 'ccx-silence-e2e-'))

    // 假 binary：噪声 + latin1 高位锚 + 噪声（探活候选字节的原始形态）
    const binaryPath = join(homeDir, 'claude-raw')
    writeFileSync(binaryPath, Buffer.from('noise-head' + ANCHOR_BEFORE + 'noise-tail', 'latin1'))

    const pm = new PluginsManager({ internalPlugins: [], homeDir })
    expect(pm.add(silenceManifest)).toBe('added')

    // token-expansion 缺席（internalPlugins 空）：patches 全来自 silence plugin，
    // shortVer 只含 sil，产物名 claude-sil
    const ctx = await collectPluginContext({ internalPlugins: [], homeDir, version: '2.1.285' })
    expect(ctx.installedPatches).toHaveLength(1)
    expect(ctx.installedPatches[0].search).toBe(ANCHOR_BEFORE)

    const configService = {
      ensureDirs: vi.fn(),
      recordPatchedCombo: vi.fn()
    } as unknown as ConfigService
    const packageService = {
      isInstalled: () => true,
      getBinaryPath: () => binaryPath
    } as unknown as PackageService

    const applier = new PatchApplier()
    const prepared = await applier.prepare('2.1.285', {
      configService,
      packageService,
      pluginsManager: pm,
      installedPatches: ctx.installedPatches
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.error.message)

    const result = await applier.execute('2.1.285', 200000, prepared.data, {
      configService,
      packageService,
      pluginsManager: pm,
      homeDir
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)

    // 命名：无 internal plugin → shortVer = sil
    expect(result.data.binaryPath.endsWith('/claude-sil')).toBe(true)
    expect(result.data.replaceCount).toBe(1)

    // 字节级断言：原锚消失、目标锚出现（latin1 比对，不经过 utf8 往返）
    const patched = readFileSync(result.data.binaryPath)
    expect(patched.indexOf(Buffer.from(ANCHOR_BEFORE, 'latin1'))).toBe(-1)
    expect(patched.indexOf(Buffer.from(ANCHOR_AFTER, 'latin1'))).toBeGreaterThan(-1)
    expect(patched.length).toBe(Buffer.byteLength('noise-head' + ANCHOR_BEFORE + 'noise-tail', 'latin1'))

    rmSync(homeDir, { recursive: true, force: true })
  })

  it('仓根 ccx-plugins.json 索引含合法的 silence manifest（plugins add 的拉取源）', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const index = JSON.parse(readFileSync(join(repoRoot, 'ccx-plugins.json'), 'utf8')) as {
      plugins: PluginManifest[]
    }
    expect(Array.isArray(index.plugins)).toBe(true)

    const silence = index.plugins.find(p => p.name === 'silence-unrecognized-model')
    expect(silence).toBeDefined()

    // 与 validateManifest（plugins 命令）同口径的结构校验
    expect(silence!.name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(silence!.shardBaseUrl).toMatch(/^https?:\/\//)
    expect(silence!.shortVer).toEqual({ kind: 'literal', value: 'sil' })

    // 索引里的 manifest 经 PluginsManager.add 不与 internal 冲突（同名校验）
    const fakeInternal: InternalPluginDefinition[] = [{
      manifest: { name: 'token-expansion', shardBaseUrl: 'https://x/', shortVer: { kind: 'token-target' } },
      strategies: {}
    }]
    const homeDir = mkdtempSync(join(tmpdir(), 'ccx-silence-idx-'))
    const pm = new PluginsManager({ internalPlugins: fakeInternal, homeDir })
    expect(pm.add(silence!)).toBe('added')
    rmSync(homeDir, { recursive: true, force: true })
  })
})
