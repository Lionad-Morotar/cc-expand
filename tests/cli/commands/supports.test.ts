import { describe, it, expect, vi } from 'vitest'
import { supportsCommand } from '../../../src/cli/commands/supports.js'
import { ConfigService } from '../../../src/services/config.js'

describe('supports command', () => {
  const createMockConfig = (versions: string[] = ['2.1.161', '2.1.170']) => {
    const mockIndex = versions.map((v) => ({
      version: v,
      platforms: ['darwin-arm64', 'darwin-x64'],
    }))
    return {
      getVersionIndex: vi.fn().mockResolvedValue(mockIndex),
    } as unknown as ConfigService
  }

  it('returns structured result with all supported versions', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('supports')
    expect(result.data?.versions).toHaveLength(2)
    expect(result.data?.versions.map((v) => v.version)).toEqual(['2.1.161', '2.1.170'])
    expect(result.data?.versions[0]?.platforms).toEqual(['darwin-arm64', 'darwin-x64'])
  })

  it('marks current version in structured data', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    const current = result.data?.versions.find((v) => v.current)
    expect(current?.version).toBe('2.1.170')
  })

  it('warns when current version is NOT in the list', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.999'),
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(result.warnings?.length).toBeGreaterThan(0)
    expect(result.warnings?.[0]).toContain('2.1.999')
  })

  it('does not mark any version current when claude is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(result.data?.versions.every((v) => !v.current)).toBe(true)
    expect(result.warnings?.length ?? 0).toBe(0)
  })
})
