import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchCommand } from '../../../src/cli/commands/patch.js'
import { patchRemoveCommand } from '../../../src/cli/commands/patch-remove.js'
import { ConfigService } from '../../../src/services/config.js'
import { PatchCleanupService } from '../../../src/services/patch-cleanup.js'
import type { UserConfigService } from '../../../src/services/user-config.js'

describe('patch command argument validation', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-patch-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should reject --target without value', async () => {
    const result = await patchCommand(['--target'])
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('--target requires a value')
  })

  it('should reject non-numeric --target', async () => {
    const result = await patchCommand(['--target', 'abc'])
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('should reject --target with zero', async () => {
    const result = await patchCommand(['--target', '0'])
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('should reject --target with negative number', async () => {
    const result = await patchCommand(['--target', '-1'])
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('should accept --target with k suffix', async () => {
    const result = await patchCommand(['--target', '270k'])
    // 没有安装包和 pattern，会在后面失败，但参数解析不应报 Invalid target tokens
    if (!result.success) {
      expect(result.error?.message).not.toContain('Invalid target tokens')
    }
  })

  it('should accept --target with w suffix', async () => {
    const result = await patchCommand(['--target', '27w'])
    if (!result.success) {
      expect(result.error?.message).not.toContain('Invalid target tokens')
    }
  })

  it('should suggest available combos when --yes given without --target', async () => {
    // 预置：激活版本 2.1.190 已有 patch 记录（combos）
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'versions.json'), JSON.stringify({
      patchedVersions: { '2.1.190': { combos: ['27w', '70w'], patchedAt: '2026-07-01T00:00:00Z' } }
    }))
    writeFileSync(join(configDir, 'channel.json'), JSON.stringify({
      channel: 'local',
      path: join(tempDir, '.cc-expand', 'packages', '2.1.190'),
      version: '2.1.190'
    }))
    const result = await patchCommand(['--yes'])
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('--yes requires --target')
    // suggestion 增强列出可用 combo，指引用户下一步（而非固定文案）
    expect(result.error?.suggestion ?? '').toContain('27w')
  })

  it('should hint to patch first when --yes given but active version has no record', async () => {
    // channel 指向 2.1.190，但 versions.json 无该版本记录 → suggestion 应提示先 patch
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'channel.json'), JSON.stringify({
      channel: 'local',
      path: join(tempDir, '.cc-expand', 'packages', '2.1.190'),
      version: '2.1.190'
    }))
    const result = await patchCommand(['--yes'])
    expect(result.success).toBe(false)
    expect(result.error?.suggestion ?? '').toMatch(/no patch record|first/i)
  })

  /** 预置本地 fake package，让 isInstalled 为真从而跳过真实下载 */
  function presetFakePackage(version: string): void {
    const binDir = join(tempDir, '.cc-expand', 'packages', version, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'claude'), 'fake-binary')
  }

  /** stub ConfigService：getPatternForVersion 返回 null，避免请求 OSS pattern */
  const stubConfig = {
    ensureDirs: () => {},
    getPatternForVersion: async () => null
  } as unknown as ConfigService

  it('should accept version as positional argument', async () => {
    presetFakePackage('2.1.170')
    const result = await patchCommand(['2.1.170'], { configService: stubConfig })
    // version 被解析后会走到 pattern 缺失，错误信息含版本号，且不再是 "No version specified"
    expect(result.error?.message ?? '').not.toContain('No version specified')
    expect(result.error?.message ?? '').toContain('2.1.170')
  })

  it('should accept version positional alongside --target', async () => {
    presetFakePackage('2.1.170')
    const result = await patchCommand(['2.1.170', '--target', '500000'], { configService: stubConfig })
    expect(result.error?.message ?? '').not.toContain('No version specified')
    expect(result.error?.message ?? '').not.toContain('Invalid target tokens')
  })

  it('should not mistake --target value for version', async () => {
    presetFakePackage('2.1.170')
    // --target 的值 500000 不应被当成 version；version 应解析为末尾的位置参数 2.1.170
    const result = await patchCommand(['--target', '500000', '2.1.170'], { configService: stubConfig })
    expect(result.error?.message ?? '').not.toContain('No version specified')
    expect(result.error?.message ?? '').toContain('2.1.170')
  })

  it('warns when bytecode version (2.1.250) has no anchor on this platform', async () => {
    // 真实链路：2.1.250 + 无 bytecodePatterns 的 pattern → patch 成功但 bytecodeAnchorMissing，
    // warnings 应渲染 i18n 文案（含版本号与平台标识）
    const version = '2.1.250'
    presetFakePackage(version)
    const binPath = join(tempDir, '.cc-expand', 'packages', version, 'bin', 'claude')
    // 纯文本锚点 binary：文本替换可成功，无 bytecode 常量池
    writeFileSync(binPath, 'Aj8=200000,Ij_=20000_X93=200000')

    const config = {
      ensureDirs: () => {},
      getPatternForVersion: async () => [
        { search: 'Aj8=200000,Ij_=20000', desc: 'token', sourceValue: '200000' }
      ],
      recordPatchedCombo: () => {}
    } as unknown as ConfigService
    // autoMaintain 关闭：跳过 shell profile 维护，聚焦警告断言
    const userConfigService = {
      get: (key: string) => (key === 'autoMaintain' ? false : undefined)
    } as unknown as UserConfigService

    const result = await patchCommand(
      [version, '--target', '270000', '--yes'],
      { configService: config, userConfigService }
    )

    expect(result.success).toBe(true)
    expect(result.warnings?.length).toBe(1)
    const warning = result.warnings?.[0] ?? ''
    expect(warning).toContain(version)
    expect(warning).toContain(`${process.platform}-${process.arch}`)
    expect(warning).toMatch(/bytecode/i)
  })
})

describe('patch remove command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-patch-remove-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createBinary(combo: string): void {
    const ext = process.platform === 'win32' ? '.exe' : ''
    const binDir = join(tempDir, '.cc-expand', 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, `claude-${combo}${ext}`), 'fake-binary')
  }

  function createConfigWithCombos(version: string, combos: string[]): ConfigService {
    const config = new ConfigService({ homeDir: tempDir })
    for (const combo of combos) {
      config.recordPatchedCombo(version, combo)
    }
    return config
  }

  it('requires a version', async () => {
    const result = await patchRemoveCommand([])
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('Remove requires a version')
  })

  it('removes a single combo and its binary', async () => {
    const config = createConfigWithCombos('2.1.186', ['27w', '27w-flow'])
    createBinary('27w')
    createBinary('27w-flow')

    const result = await patchRemoveCommand(['2.1.186', '27w'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(true)
    expect(result.data?.removedCombos).toEqual(['27w'])
    expect(config.getUserConfig().patchedVersions['2.1.186']?.combos).toEqual(['27w-flow'])
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-27w'))).toBe(false)
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-27w-flow'))).toBe(true)
  })

  it('normalizes token combo input (270000 -> 27w)', async () => {
    const config = createConfigWithCombos('2.1.186', ['27w'])
    createBinary('27w')

    const result = await patchRemoveCommand(['2.1.186', '270000'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(true)
    expect(result.data?.removedCombos).toEqual(['27w'])
  })

  it('normalizes token combo input with plugin segment (270k-flow -> 27w-flow)', async () => {
    const config = createConfigWithCombos('2.1.186', ['27w-flow'])
    createBinary('27w-flow')

    const result = await patchRemoveCommand(['2.1.186', '270k-flow'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(true)
    expect(result.data?.removedCombos).toEqual(['27w-flow'])
  })

  it('returns error when combo does not exist', async () => {
    const config = createConfigWithCombos('2.1.186', ['27w'])

    const result = await patchRemoveCommand(['2.1.186', 'missing'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PATTERN_NOT_FOUND')
  })

  it('removes all combos for a version when combo is omitted', async () => {
    const config = createConfigWithCombos('2.1.186', ['27w', '27w-flow'])
    createBinary('27w')
    createBinary('27w-flow')

    const result = await patchRemoveCommand(['2.1.186'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(true)
    expect(result.data?.removedCombos).toContain('27w')
    expect(result.data?.removedCombos).toContain('27w-flow')
    expect(config.getUserConfig().patchedVersions['2.1.186']).toBeUndefined()
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-27w'))).toBe(false)
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-27w-flow'))).toBe(false)
  })

  it('returns error when version has no patch records', async () => {
    const config = new ConfigService({ homeDir: tempDir })

    const result = await patchRemoveCommand(['2.1.186'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PATTERN_NOT_FOUND')
  })

  it('cleans up both shortVer and raw-target binaries for legacy records', async () => {
    const config = new ConfigService({ homeDir: tempDir })
    config.setUserConfig({
      patchedVersions: {
        '2.1.186': { targets: [270000], patchedAt: 'x' }
      }
    })
    createBinary('27w')
    createBinary('270000')

    const result = await patchRemoveCommand(['2.1.186'], {
      configService: config,
      patchCleanupService: new PatchCleanupService({ homeDir: tempDir })
    })

    expect(result.success).toBe(true)
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-27w'))).toBe(false)
    expect(existsSync(join(tempDir, '.cc-expand', 'bin', 'claude-270000'))).toBe(false)
  })
})
