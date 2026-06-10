import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { statusCommand } from '../../../src/cli/commands/status.js'

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

  it('returns formatted status when binary is patched', async () => {
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

    const output = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(output.startsWith('[INFO]')).toBe(true)
    expect(output).toContain('2.1.170')
    expect(output).toContain('256000')
    expect(output).toContain('/path/to/claude')
  })

  it('returns formatted status when binary is unpatched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {},
      }),
    }

    const output = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(output.startsWith('[INFO]')).toBe(true)
    expect(output).toContain('未 patch')
  })
})
