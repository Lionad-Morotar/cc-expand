import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { supportsCommand } from '../../../src/cli/commands/supports.js'

describe('supports command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('should list all supported versions with platform info', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }

    await supportsCommand([], { discoveryService: mockDiscovery as any })

    const lines = logSpy.mock.calls.map((c) => c[0] as string)
    expect(lines[0]).toBe('Supported versions:')
    expect(lines.some((l) => l.includes('2.1.161'))).toBe(true)
    expect(lines.some((l) => l.includes('2.1.170'))).toBe(true)
    expect(lines.some((l) => l.includes('darwin-arm64'))).toBe(true)
  })

  it('should append ← current when current version is in the list', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }

    await supportsCommand([], { discoveryService: mockDiscovery as any })

    const lines = logSpy.mock.calls.map((c) => c[0] as string)
    const currentLine = lines.find((l) => l.includes('2.1.170'))
    expect(currentLine).toContain('← current')
  })

  it('should warn when current version is NOT in the list', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue('/fake/claude'),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.999'),
    }

    await supportsCommand([], { discoveryService: mockDiscovery as any })

    const errorLines = errorSpy.mock.calls.map((c) => c[0] as string)
    expect(errorLines.some((l) => l.includes('2.1.999'))).toBe(true)
    expect(errorLines.some((l) => l.includes('NOT supported'))).toBe(true)
  })

  it('should not show current highlight when claude is not installed', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockRejectedValue(new Error('not found')),
      getBinaryVersion: vi.fn().mockResolvedValue('unknown'),
    }

    await supportsCommand([], { discoveryService: mockDiscovery as any })

    const lines = logSpy.mock.calls.map((c) => c[0] as string)
    expect(lines.some((l) => l.includes('← current'))).toBe(false)

    const errorLines = errorSpy.mock.calls.map((c) => c[0] as string)
    expect(errorLines.length).toBe(0)
  })
})
