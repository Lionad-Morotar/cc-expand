import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrationCommand } from '../../../src/cli/commands/migration.js'
import { ConfigService } from '../../../src/services/config.js'
import { DiscoveryService } from '../../../src/services/discovery.js'
import type { PatchApplier, AppliedPatch, PreparedPattern, ApplyPatchOutcome, PrepareOutcome } from '../../../src/services/patch-applier.js'

/** 写入 versions.json（patchedVersions 记录），供 ConfigService 读取 */
function writeVersions(homeDir: string, patchedVersions: Record<string, { targets: number[]; patchedAt: string }>): void {
  const configDir = join(homeDir, '.cc-expand')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'versions.json'), JSON.stringify({ patchedVersions }, null, 2))
}

/** stub DiscoveryService：可控地返回当前 binary 版本或抛错 */
function stubDiscovery(currentVersion: string | null): DiscoveryService {
  return {
    findClaudeBinary: async () => {
      if (currentVersion === null) throw new Error('not found')
      return '/fake/claude'
    },
    getBinaryVersion: async () => currentVersion ?? 'unknown',
  } as unknown as DiscoveryService
}

/** 构造一个可控的 PatchApplier stub */
function makeApplierStub(opts: {
  prepareOk?: boolean
  /** 按 target 决定 execute 结果；缺省全部成功 */
  execute?: (target: number) => ApplyPatchOutcome
} = {}): PatchApplier {
  const prepared: PreparedPattern = {
    patches: [{ search: 'x=200000', desc: 'ctx-window', sourceValue: '200000' }],
    sourceValue: '200000',
  }
  const prepareResult: PrepareOutcome = opts.prepareOk === false
    ? { ok: false, error: { code: 'PATTERN_NOT_FOUND' as never, message: 'No pattern for target', suggestion: 'ccx supports' } }
    : { ok: true, data: prepared }
  return {
    prepare: async () => prepareResult,
    execute: async (version: string, target: number): Promise<ApplyPatchOutcome> => {
      if (opts.execute) return opts.execute(target)
      const data: AppliedPatch = {
        version,
        targetTokens: target,
        sourceValue: '200000',
        replaceCount: 1,
        binaryPath: `/fake/claude-${target}`,
        details: [],
      }
      return { ok: true, data }
    },
  } as unknown as PatchApplier
}

describe('migration command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-migration-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('source resolution', () => {
    it('should error when no patches exist and no current binary', async () => {
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery(null),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('No existing patches')
    })

    it('should error when --from version has no patch record', async () => {
      writeVersions(tempDir, { '2.1.170': { targets: [270000], patchedAt: '2026-06-10T10:00:00Z' } })
      const result = await migrationCommand(['--from', '2.1.999'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery(null),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('2.1.999')
    })

    it('should pick current binary version when it has a patch record', async () => {
      writeVersions(tempDir, {
        '2.1.177': { targets: [1000000, 500000], patchedAt: '2026-06-15T10:00:00Z' },
        '2.1.170': { targets: [270000], patchedAt: '2026-06-10T10:00:00Z' },
      })
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.data?.fromVersion).toBe('2.1.177')
      expect(result.data?.migratedTargets).toEqual([1000000, 500000])
    })

    it('should fall back to most recently patched version when current binary has no record', async () => {
      writeVersions(tempDir, {
        '2.1.175': { targets: [270000], patchedAt: '2026-06-12T10:00:00Z' },
        '2.1.173': { targets: [270000, 271000], patchedAt: '2026-06-11T10:00:00Z' },
      })
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('9.9.9'), // 当前版本无记录
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.data?.fromVersion).toBe('2.1.175')
    })

    it('should use explicit --from when it has a record', async () => {
      writeVersions(tempDir, {
        '2.1.170': { targets: [270000], patchedAt: '2026-06-10T10:00:00Z' },
        '2.1.173': { targets: [270000, 271000], patchedAt: '2026-06-11T10:00:00Z' },
      })
      const result = await migrationCommand(['--from', '2.1.173', '--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.170'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.data?.fromVersion).toBe('2.1.173')
      expect(result.data?.migratedTargets).toEqual([270000, 271000])
    })
  })

  describe('target resolution', () => {
    it('should resolve latest via injected resolver', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      let calledWith = ''
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async (v) => { calledWith = v; return '2.1.178' },
      })
      expect(result.success).toBe(true)
      expect(calledWith).toBe('latest')
      expect(result.data?.toVersion).toBe('2.1.178')
    })

    it('should use positional version directly without resolving latest', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      let called = false
      const result = await migrationCommand(['2.1.180', '--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => { called = true; return '2.1.180' },
      })
      expect(result.success).toBe(true)
      expect(result.data?.toVersion).toBe('2.1.180')
      expect(called).toBe(false)
    })

    it('should error when latest resolution fails', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => { throw new Error('network') },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('idempotency and dry-run', () => {
    it('should be a no-op when target equals source', async () => {
      writeVersions(tempDir, { '2.1.178': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.178'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.data?.migratedTargets).toEqual([])
    })

    it('should not execute patches in dry-run mode', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [1000000, 500000], patchedAt: '2026-06-15T10:00:00Z' } })
      let executeCalled = false
      const applier = makeApplierStub({ execute: () => { executeCalled = true; return { ok: true, data: {} as AppliedPatch } } })
      const result = await migrationCommand(['--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: applier,
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.data?.dryRun).toBe(true)
      expect(executeCalled).toBe(false)
      expect(result.data?.migratedTargets).toEqual([1000000, 500000])
    })
  })

  describe('execution', () => {
    it('should migrate all targets and switch channel', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [1000000, 500000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.data?.migratedTargets).toEqual([1000000, 500000])
      expect(result.data?.failedTargets).toEqual([])
      expect(result.data?.channelUpdated).toBe(true)
      // channel.json 切换到新版本
      const channel = JSON.parse(readFileSync(join(tempDir, '.cc-expand', 'channel.json'), 'utf-8'))
      expect(channel.version).toBe('2.1.178')
    })

    it('should continue on partial failure and report warnings', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [1000000, 500000, 190000], patchedAt: '2026-06-15T10:00:00Z' } })
      const applier = makeApplierStub({
        execute: (target) => target === 500000
          ? { ok: false, error: { code: 'PATCH_FAILED' as never, message: 'boom', suggestion: 'retry' } }
          : { ok: true, data: { version: '2.1.178', targetTokens: target, sourceValue: '200000', replaceCount: 1, binaryPath: `/fake/claude-${target}`, details: [] } },
      })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: applier,
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true) // 至少一个成功
      expect(result.data?.migratedTargets).toEqual([1000000, 190000])
      expect(result.data?.failedTargets.map(f => f.target)).toEqual([500000])
      expect(result.warnings?.some(w => w.includes('500000'))).toBe(true)
    })

    it('should fail when all targets fail', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T10:00:00Z' } })
      const applier = makeApplierStub({
        execute: () => ({ ok: false, error: { code: 'PATCH_FAILED' as never, message: 'boom', suggestion: 'retry' } }),
      })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: applier,
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(false)
    })

    it('should surface prepare failure as error', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub({ prepareOk: false }),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PATTERN_NOT_FOUND')
    })
  })

  describe('argument & latest resolution edge cases', () => {
    it('should error when --from has no value', async () => {
      const result = await migrationCommand(['--from'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery(null),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('--from requires a value')
    })

    it('should normalize v-prefix on --from so it matches versions.json keys', async () => {
      writeVersions(tempDir, { '2.1.170': { targets: [270000], patchedAt: '2026-06-10T10:00:00Z' } })
      const result = await migrationCommand(['--from', 'v2.1.170', '--dry-run'], {
        homeDir: tempDir,
        discoveryService: stubDiscovery(null),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.data?.fromVersion).toBe('2.1.170')
    })

    it('should error when latest resolves to undefined (npm failure)', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => undefined,
      })
      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Failed to resolve latest')
    })

    it('should error when latest resolver returns literal "latest" (unresolved)', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [270000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => 'latest',
      })
      expect(result.success).toBe(false)
    })

    it('should list all migrated targets in next steps', async () => {
      writeVersions(tempDir, { '2.1.177': { targets: [1000000, 500000, 190000], patchedAt: '2026-06-15T10:00:00Z' } })
      const result = await migrationCommand([], {
        homeDir: tempDir,
        discoveryService: stubDiscovery('2.1.177'),
        patchApplier: makeApplierStub(),
        resolveLatest: async () => '2.1.178',
      })
      expect(result.success).toBe(true)
      expect(result.next).toEqual([
        'ccx run 1000000',
        'ccx run 500000',
        'ccx run 190000',
      ])
    })
  })
})
