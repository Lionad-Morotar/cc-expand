import { describe, it, expect, vi } from 'vitest'
import { supportsCommand } from '../../../src/cli/commands/supports.js'
import type { ConfigService } from '../../../src/services/config.js'
import type { ChannelConfig } from '../../../src/services/channel-config.js'

describe('supports command', () => {
  const createMockConfig = (versions: string[] = ['2.1.161', '2.1.170']) => {
    const mockIndex = versions.map(v => ({
      version: v,
      platforms: ['darwin-arm64', 'darwin-x64']
    }))
    return {
      getVersionIndex: vi.fn().mockResolvedValue(mockIndex)
    } as unknown as ConfigService
  }

  // 无 channel.json：getChannel 返回 undefined，supports 应回退 PATH 探测。
  // Why 注入空 channel：supports 默认读真实 ~/.cc-expand/channel.json，开发机存在
  // 激活 channel，会污染这些「PATH 探测」用例。强制注入空 channel 隔离本机状态。
  const createEmptyChannel = () =>
    ({ getChannel: vi.fn(() => undefined) } as unknown as ChannelConfig)

  it('returns structured result with all supported versions', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown')
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
      channelConfig: createEmptyChannel()
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('supports')
    expect(result.data?.versions).toHaveLength(2)
    expect(result.data?.versions.map(v => v.version)).toEqual(['2.1.161', '2.1.170'])
    expect(result.data?.versions[0]?.platforms).toEqual(['darwin-arm64', 'darwin-x64'])
  })

  it('marks current version in structured data', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
      channelConfig: createEmptyChannel()
    })

    const current = result.data?.versions.find(v => v.current)
    expect(current?.version).toBe('2.1.170')
  })

  it('warns when current version is NOT in the list', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.999')
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
      channelConfig: createEmptyChannel()
    })

    expect(result.warnings?.length).toBeGreaterThan(0)
    expect(result.warnings?.[0]).toContain('2.1.999')
  })

  it('does not mark any version current when claude is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown')
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
      channelConfig: createEmptyChannel()
    })

    expect(result.data?.versions.every(v => !v.current)).toBe(true)
    expect(result.warnings?.length ?? 0).toBe(0)
  })

  /**
   * Why 这个回归断言：supports 曾跳过 channel.json 直接 PATH 探测，导致 current 标到
   * 系统旧 claude（homebrew 2.1.161）而非激活版本（2.1.186）。channel.json 存在时，
   * supports 必须用 channel.version，且不应调用 discovery（ADR 0001：channel 优先）。
   */
  it('prefers channel.json active version over PATH binary (ADR 0001)', async () => {
    const mockChannel = {
      getChannel: vi.fn(() => ({
        channel: 'npm',
        path: '/fake/channel/claude',
        version: '2.1.170'
      }))
    } as unknown as ChannelConfig
    // PATH 上的 claude 是更旧的版本——若 supports 误走 PATH 探测会标错
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/opt/homebrew/bin/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.999')
    }
    const mockConfig = createMockConfig()

    const result = await supportsCommand([], {
      discoveryService: mockDiscovery as any,
      configService: mockConfig,
      channelConfig: mockChannel
    })

    const current = result.data?.versions.find(v => v.current)
    expect(current?.version).toBe('2.1.170')
    // channel 命中时不应回退 PATH 探测
    expect(mockDiscovery.findClaudeBinary).not.toHaveBeenCalled()
  })
})
