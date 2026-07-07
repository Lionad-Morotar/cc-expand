import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { statusCommand } from '../../../src/cli/commands/status.js'
import { ChannelConfig } from '../../../src/services/channel-config.js'
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
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.170': {
            targets: [256000],
            patchedAt: '2026-06-10T14:32:00.000Z'
          }
        }
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.170' // latest == current，不触发 migration 建议
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
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {}
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any
    })

    expect(result.success).toBe(true)
    expect(result.data?.patched).toBe(false)
    expect(result.data?.version).toBe('2.1.170')
    expect(result.next).toBeUndefined() // 未 patch 时不建议 migration
  })

  it('returns friendly info when Claude Code is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(
        new CcxError(ErrorCode.BINARY_NOT_FOUND, 'not found')
      ),
      getBinaryVersion: vi.fn()
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {}
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any
    })

    expect(result.success).toBe(true)
    expect(result.data?.patched).toBe(false)
    expect(result.summary).toContain('not installed')
  })

  it('suggests migration in next when a newer version is available and current is patched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000, 500000], patchedAt: '2026-06-15T00:00:00Z' }
        }
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.178'
    })

    expect(result.data?.patched).toBe(true)
    expect(result.next).toEqual(['ccx migration latest'])
  })

  it('does not suggest migration when latest resolution fails or times out', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00Z' }
        }
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => { throw new Error('network') }
    })

    expect(result.data?.patched).toBe(true)
    expect(result.next).toBeUndefined() // latest 查询失败不破坏主输出，静默跳过
  })

  it('does not suggest migration when latest is already patched (already migrated)', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177')
    }
    // current=2.1.177（系统版本），latest=2.1.178 已被 migration patch → 不应重复建议
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00Z' },
          '2.1.178': { targets: [1000000], patchedAt: '2026-06-16T00:00:00Z' }
        }
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.178'
    })

    expect(result.data?.patched).toBe(true)
    expect(result.next).toBeUndefined()
  })

  // --- Active Version (channel.json) 优先于 System Version (PATH) ---
  // 见 ADR 0001：status 应与 patch/setup 对齐，以 channel.json.version 为权威当前版本
  it('reports active version from channel.json when present (post-migration)', async () => {
    // PATH 上仍是旧版本 2.1.177（模拟 migration 未改 PATH 原生二进制）
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00Z' },
          '2.1.178': { targets: [1000000, 500000], patchedAt: '2026-06-16T00:00:00Z' }
        }
      })
    }

    // channel.json 已被 migration 切到 2.1.178
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    new ChannelConfig(configDir).saveChannel({
      channel: 'local',
      path: join(configDir, 'packages', '2.1.178'),
      version: '2.1.178'
    })

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.178'
    })

    // 关键：version 来自 channel（2.1.178），而非 PATH 的 2.1.177
    expect(result.data?.version).toBe('2.1.178')
    expect(result.data?.activeSource).toBe('channel')
    expect(result.data?.patched).toBe(true)
    expect(result.data?.targets).toEqual([1000000, 500000])
    // 已是 latest，不应重复建议 migration
    expect(result.next).toBeUndefined()
  })

  it('reports active version as unpatched when channel version has no patch record', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.177')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00Z' }
        }
      })
    }
    // channel 指向 2.1.178，但 2.1.178 尚未 patch（如 setup 选定版本后未 patch）
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    new ChannelConfig(configDir).saveChannel({
      channel: 'local',
      path: join(configDir, 'packages', '2.1.178'),
      version: '2.1.178'
    })

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any
    })

    expect(result.data?.version).toBe('2.1.178')
    expect(result.data?.activeSource).toBe('channel')
    expect(result.data?.patched).toBe(false)
  })

  it('falls back to system version (PATH) with activeSource=system when no channel.json', async () => {
    // 不写 channel.json —— 模拟未 setup 的老用户，行为须保持不变
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.170': { targets: [256000], patchedAt: '2026-06-10T00:00:00Z' }
        }
      })
    }

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.170'
    })

    expect(result.data?.version).toBe('2.1.170')
    expect(result.data?.activeSource).toBe('system')
    expect(result.data?.patched).toBe(true)
  })

  it('falls back to system version when channel.json is corrupted (must not crash)', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/usr/local/bin/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.170': { targets: [256000], patchedAt: '2026-06-10T00:00:00Z' }
        }
      })
    }
    // channel.json 损坏（非法 JSON，如手编或写入被中断）——status 不得崩溃，应回退 PATH 探测
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'channel.json'), '{ not valid json')

    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.170'
    })

    expect(result.success).toBe(true)
    expect(result.data?.activeSource).toBe('system')
    expect(result.data?.version).toBe('2.1.170')
  })

  it('exposes combos in installedVersions for plugin-era records (no targets field)', async () => {
    // 真实磁盘形态：plugin 重构后 patch 的版本只有 combos、无 targets
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.197')
    }
    const mockConfig = {
      getUserConfig: vi.fn().mockReturnValue({
        patchedVersions: {
          '2.1.197': { combos: ['27w', '70w'], patchedAt: '2026-07-01T00:00:00Z' }
        }
      })
    }
    const result = await statusCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
      latestResolver: async () => '2.1.197'
    })
    expect(result.success).toBe(true)
    expect(result.data?.combos).toEqual(['27w', '70w'])
    // installedVersions 数组里也必须含 combos（修复前只填 targets，combos-only 版本显示空）
    const entry = result.data?.installedVersions?.find(v => v.version === '2.1.197')
    expect(entry?.combos).toEqual(['27w', '70w'])
  })
})
