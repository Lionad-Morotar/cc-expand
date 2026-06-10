import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getNpmCommand, PackageService } from '../../src/services/package.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('getNpmCommand', () => {
  let originalPlatform: PropertyDescriptor | undefined

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  function setPlatform(platform: string) {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    })
  }

  it('should return npm.cmd on Windows', () => {
    setPlatform('win32')
    expect(getNpmCommand()).toBe('npm.cmd')
  })

  it('should return npm on macOS', () => {
    setPlatform('darwin')
    expect(getNpmCommand()).toBe('npm')
  })

  it('should return npm on Linux', () => {
    setPlatform('linux')
    expect(getNpmCommand()).toBe('npm')
  })
})

describe('PackageService.resolveVersion', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-resolve-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createMockExecFile(
    result: { error?: Error; stdout: string },
    assert?: (file: string, args: string[]) => void,
  ) {
    return vi.fn((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      if (assert) assert(file, args)
      callback(result.error ?? null, result.stdout)
    })
  }

  it('should return semver version as-is', async () => {
    const execFileMock = createMockExecFile({ stdout: '' })
    const service = new PackageService(tempDir, execFileMock as any)

    const resolved = await service.resolveVersion('2.1.170')
    expect(resolved).toBe('2.1.170')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('should return "latest" if npm view fails', async () => {
    const execFileMock = createMockExecFile({ error: new Error('network error'), stdout: '' })
    const service = new PackageService(tempDir, execFileMock as any)

    const resolved = await service.resolveVersion('latest')
    expect(resolved).toBe('latest')
  })

  it('should resolve latest tag via npm view', async () => {
    const execFileMock = createMockExecFile(
      { stdout: '"2.1.170"' },
      (file, args) => {
        expect(file).toMatch(/npm(?:\.cmd)?$/)
        expect(args).toEqual([
          'view',
          '@anthropic-ai/claude-code@latest',
          'version',
          '--json',
        ])
      },
    )
    const service = new PackageService(tempDir, execFileMock as any)

    const resolved = await service.resolveVersion('latest')
    expect(resolved).toBe('2.1.170')
  })

  it('should handle non-JSON npm view output gracefully', async () => {
    const execFileMock = createMockExecFile({ stdout: '2.1.170\n' })
    const service = new PackageService(tempDir, execFileMock as any)

    const resolved = await service.resolveVersion('latest')
    expect(resolved).toBe('2.1.170')
  })
})
