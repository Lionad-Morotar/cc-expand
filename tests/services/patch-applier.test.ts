import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatchApplier } from '../../src/services/patch-applier.js'
import type { ConfigService } from '../../src/services/config.js'
import type { PackageService } from '../../src/services/package.js'
import { PluginsManager } from '../../src/services/plugins-manager.js'
import { INTERNAL_PLUGINS } from '../../src/internal-plugins.js'
import type { PatchItem } from '../../src/types/index.js'

/** bytecode 锚点（与 bytecode-patch-engine.test 同款实证锚点） */
const BC_ANCHOR_HEX = '{{tokens}}007d0000 00f40100 40420f00'.replace(/\s/g, '')

/** 构造含文本锚点 + bytecode 槽位的假 binary */
function fakeBinary(token = 200000): Buffer {
  const slot = Buffer.alloc(4)
  slot.writeUInt32LE(token)
  return Buffer.concat([
    Buffer.from('Aj8=200000,Ij_=20000_X93=200000', 'utf8'),
    slot,
    Buffer.from('007d0000 00f40100 40420f00'.replace(/\s/g, ''), 'hex')
  ])
}

/** execute 全链路的公共夹具：prepare（注入带 bytecodePatterns 的 token pattern）→ execute */
async function runExecute(binaryBuffer: Buffer) {
  const homeDir = mkdtempSync(join(tmpdir(), 'ccx-applier-'))
  const binaryPath = join(homeDir, 'claude-raw')
  writeFileSync(binaryPath, binaryBuffer)

  const tokenPatches: PatchItem[] = [
    { search: 'Aj8=200000,Ij_=20000', desc: 'token', sourceValue: '200000', bytecodePatterns: [BC_ANCHOR_HEX] }
  ]
  const configService = {
    ensureDirs: vi.fn(),
    getPatternForVersion: vi.fn().mockResolvedValue(tokenPatches),
    recordPatchedCombo: vi.fn()
  } as unknown as ConfigService
  const packageService = {
    isInstalled: () => true,
    getBinaryPath: () => binaryPath
  } as unknown as PackageService

  const applier = new PatchApplier()
  const prepared = await applier.prepare('2.1.250', { configService, packageService })
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.error.message}`)

  const result = await applier.execute('2.1.250', 270000, prepared.data, { configService, packageService, homeDir })
  return { result, homeDir, configService }
}

describe('PatchApplier.prepare() plugin 聚合', () => {
  it('合并 token patches + installed plugin patches（literal target）', async () => {
    const tokenPatches: PatchItem[] = [
      { search: 'Aj8=200000', desc: 'token', sourceValue: '200000' }
    ]
    const installedPatches: PatchItem[] = [
      { search: 'AAA', sourceValue: 'AAA', target: { value: 'BBB' } }
    ]
    const configService = {
      ensureDirs: vi.fn(),
      getPatternForVersion: vi.fn().mockResolvedValue(tokenPatches)
    } as unknown as ConfigService
    const packageService = {
      isInstalled: () => true
    } as unknown as PackageService

    const applier = new PatchApplier()
    const prepared = await applier.prepare('2.1.186', {
      configService,
      packageService,
      installedPatches
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
      getPatternForVersion: vi.fn().mockResolvedValue([{ search: 'X', sourceValue: '200000' }])
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
        // 每个锚点携带 COMPANION_SIGNATURES 中的签名伴生值，满足 discovery 的结构不变量（≥5 条）
        'a1b=200000,c=32000',
        'd2e=200000,f=128000',
        'g3h=200000,i=1536,j=20',
        'k4l=200000,m=50,n=1e4',
        'o5p=200000,q=26214400,r=2',
        'p6q=200000,s=50000000,t=3',
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
      expect(prepared.data.patches).toHaveLength(7) // 6 锚点 + exceeds200k 阈值
      expect(prepared.data.sourceValue).toBe('200000')
      // discovery 产出的 patch 应带有 desc（由 classifyDesc 生成）
      expect(prepared.data.patches[0].desc).toBeDefined()
      expect(prepared.data.patches.every(p => p.sourceValue === '200000')).toBe(true)
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

describe('PatchApplier.execute() bytecode 锚点', () => {
  it('patched binary 的 bytecode 槽位被替换为目标值（文本 + 字节双替换）', async () => {
    const { result, homeDir } = await runExecute(fakeBinary(200000))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const patched = readFileSync(result.data.binaryPath)
      // 文本槽已替换
      expect(patched.toString('utf8')).toContain('270000')
      // bytecode 槽位：目标值 270000 LE = 0x00041EC0
      const targetSlot = Buffer.alloc(4)
      targetSlot.writeUInt32LE(270000)
      expect(patched.indexOf(targetSlot)).toBeGreaterThan(0)
      // 源值槽位已消失
      const sourceSlot = Buffer.alloc(4)
      sourceSlot.writeUInt32LE(200000)
      expect(patched.indexOf(sourceSlot)).toBe(-1)
    }
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('bytecode 锚点缺失时 execute 失败且不留半成品 binary', async () => {
    // binary 只有文本锚点、无 bytecode 槽位（模拟布局漂移 / 非 bytecode 版本误配）
    const { result, homeDir } = await runExecute(Buffer.from('Aj8=200000,Ij_=20000_X93=200000', 'utf8'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PATTERN_NOT_FOUND')
      expect(result.error.message).toMatch(/bytecode|anchor/i)
    }
    // 「不留半成品」的回归保护：失败路径上 patched binary 必须已被清理
    const binDir = join(homeDir, '.cc-expand', 'bin')
    expect(existsSync(join(binDir, 'claude-270000'))).toBe(false)
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('verify 通过后 combos 已记录、binary 存在', async () => {
    const { result, homeDir, configService } = await runExecute(fakeBinary(200000))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(existsSync(result.data.binaryPath)).toBe(true)
      expect(vi.mocked(configService.recordPatchedCombo).mock.calls.length).toBe(1)
    }
    rmSync(homeDir, { recursive: true, force: true })
  })
})
