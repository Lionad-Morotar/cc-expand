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
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('status')
    expect(result.data?.version).toBe('2.1.170')
    expect(result.data?.patched).toBe(true)
    expect(result.data?.targets).toEqual([256000])
    expect(result.data?.binaryPath).toBe('/path/to/claude')
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
})
