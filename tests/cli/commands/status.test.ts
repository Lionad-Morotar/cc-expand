import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { statusCommand } from '../../../src/cli/commands/status.js'
import { CcxError, ErrorCode } from '../../../src/types/index.js'

describe('status command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-status-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns structured result when binary is patched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.170': {
            targets: [256000],
            patchedAt: '2026-06-10T14:32:00.000Z',
          },
        },
      }),
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.170', // latest == current，不触发 migration 建议
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('status')
    expect(result.data?.version).toBe('2.1.170')
    expect(result.data?.patched).toBe(true)
    expect(result.data?.targets).toEqual([256000])
    expect(result.data?.binaryPath).toBe('/path/to/claude')
    expect(result.next).toBeUndefined()
  })

  it('returns structured result when binary is unpatched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {},
      }),
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(result.success).toBe(true)
    expect(result.data?.patched).toBe(false)
    expect(result.data?.version).toBe('2.1.170')
    expect(result.next).toBeUndefined() // 未 patch 时不建议 migration
  })

  it('returns friendly info when Claude Code is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(
        new CcxError(ErrorCode.BINARY_NOT_FOUND, 'not found'),
      ),
      getBinaryVersion: vi.fn(),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {},
      }),
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(result.success).toBe(true)
    expect(result.data?.patched).toBe(false)
    expect(result.summary).toContain('not installed')
  })

  it('suggests migration in next when a newer version is available and current is patched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177'),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000, 500000], patchedAt: '2026-06-15T00:00:00Z' },
        },
      }),
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.178',
    })

    expect(result.data?.patched).toBe(true)
    expect(result.next).toEqual(['ccx migration latest'])
  })

  it('does not suggest migration when latest resolution fails or times out', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177'),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00Z' },
        },
      }),
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => { throw new Error('network') },
    })

    expect(result.data?.patched).toBe(true)
    expect(result.next).toBeUndefined() // latest 查询失败不破坏主输出，静默跳过
  })
})
