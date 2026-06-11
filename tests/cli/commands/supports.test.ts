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

  it('returns [INFO] with all supported versions', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }
    const mockConfig = createMockConfig()

    const output = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(output.startsWith('[INFO]')).toBe(true)
    expect(output).toContain('2.1.161')
    expect(output).toContain('2.1.170')
    expect(output).toContain('darwin-arm64')
    expect(output).not.toContain('← 当前版本')
  })

  it('highlights current version with arrow marker', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = createMockConfig()

    const output = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(output).toContain('← 当前版本')
    expect(output).toContain('2.1.170')
  })

  it('warns when current version is NOT in the list', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.999'),
    }
    const mockConfig = createMockConfig()

    const output = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(output).toContain('⚠')
    expect(output).toContain('2.1.999')
    expect(output).toContain('不受支持')
  })

  it('does not show current highlight when claude is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }
    const mockConfig = createMockConfig()

    const output = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
    })

    expect(output).not.toContain('← 当前版本')
    expect(output).not.toContain('⚠')
  })
})
