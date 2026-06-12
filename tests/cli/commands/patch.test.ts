import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchCommand } from '../../../src/cli/commands/patch.js'

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

  it('should reject --version without value', async () => {
    const result = await patchCommand(['--version'])
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('--version requires a value')
  })

  it('should reject --version followed by another flag', async () => {
    const result = await patchCommand(['--version', '--yes'])
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('--version requires a value')
  })
})
