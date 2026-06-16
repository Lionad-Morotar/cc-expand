import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchCommand } from '../../../src/cli/commands/patch.js'
import { ConfigService } from '../../../src/services/config.js'

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

  /** 预置本地 fake package，让 isInstalled 为真从而跳过真实下载 */
  function presetFakePackage(version: string): void {
    const binDir = join(tempDir, '.cc-expand', 'packages', version, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'claude'), 'fake-binary')
  }

  /** stub ConfigService：getPatternForVersion 返回 null，避免请求 OSS pattern */
  const stubConfig = {
    ensureDirs: () => {},
    getPatternForVersion: async () => null,
    recordPatchedVersion: () => {},
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
})
