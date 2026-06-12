import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyCommand } from '../../../src/cli/commands/verify.js'

describe('verify command', () => {
  let tempDir: string
  let binaryPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-verify-'))
    binaryPath = join(tempDir, 'claude')
    // 创建一个包含原始 pattern 的 binary（模拟未 patch）
    writeFileSync(binaryPath, Buffer.from('some content with PACKAGE_T200000 and MAX_TOOL_RESULTS200000'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns structured result when binary is not patched', async () => {
    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue(binaryPath),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = {
      getPatternForVersion: vi.fn().mockResolvedValue([
        { search: 'PACKAGE_T200000', desc: 'PACKAGE_T', sourceValue: '200000' },
        { search: 'MAX_TOOL_RESULTS200000', desc: 'MAX_TOOL_RESULTS', sourceValue: '200000' },
      ]),
    }

    const result = await verifyCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('verify')
    expect(result.data?.version).toBe('2.1.170')
    expect(result.data?.patched).toBe(false)
    expect(result.data?.foundOriginals).toEqual(['PACKAGE_T', 'MAX_TOOL_RESULTS'])
  })

  it('returns structured result when binary is patched', async () => {
    // 覆盖 binary 内容，不包含原始 patterns
    writeFileSync(binaryPath, Buffer.from('some content without original patterns'))

    const mockDiscovery = {
      findClaudeBinary: vi.fn().mockResolvedValue(binaryPath),
      getBinaryVersion: vi.fn().mockResolvedValue('2.1.170'),
    }
    const mockConfig = {
      getPatternForVersion: vi.fn().mockReturnValue([
        { search: 'PACKAGE_T200000', desc: 'PACKAGE_T', sourceValue: '200000' },
      ]),
    }

    const result = await verifyCommand({
      discoveryService: mockDiscovery as any,
      configService: mockConfig as any,
    })

    expect(result.success).toBe(true)
    expect(result.data?.patched).toBe(true)
    expect(result.data?.foundOriginals).toEqual([])
  })
})
