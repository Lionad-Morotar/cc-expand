import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiscoveryService } from '../../src/services/discovery.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

describe('DiscoveryService', () => {
  let tempDir: string
  let originalPath: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-discovery-'))
    originalPath = process.env.PATH
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    if (originalPath !== undefined) {
      process.env.PATH = originalPath
    }
  })

  describe('findClaudeBinary()', () => {
    it('should find binary in PATH', async () => {
      // Arrange: create a fake claude binary in temp dir and add to PATH
      const fakeBinDir = join(tempDir, 'bin')
      mkdirSync(fakeBinDir, { recursive: true })
      const fakeClaude = join(fakeBinDir, 'claude')
      writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.100"')
      chmodSync(fakeClaude, 0o755)
      process.env.PATH = `${fakeBinDir}${process.platform === 'win32' ? ';' : ':'}${originalPath}`

      const service = new DiscoveryService()

      // Act
      const path = await service.findClaudeBinary()

      // Assert
      expect(path).toBe(fakeClaude)
    })

    it('should find binary in NPX cache', async () => {
      // Arrange: create fake NPX cache structure with claude-code
      const fakeNpxDir = join(tempDir, 'npx', 'abc123')
      mkdirSync(fakeNpxDir, { recursive: true })
      // 二进制文件名与 findInNpxCache 的平台分支一致：win32 为 claude.exe，其余为 claude
      const binName = process.platform === 'win32' ? 'claude.exe' : 'claude'
      const fakeClaude = join(fakeNpxDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', binName)
      mkdirSync(join(fakeNpxDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), { recursive: true })
      writeFileSync(fakeClaude, 'fake-binary')
      chmodSync(fakeClaude, 0o755)

      // Clear PATH so the real 'claude' is not found
      process.env.PATH = tempDir
      const service = new DiscoveryService({ npxCacheDirs: [join(tempDir, 'npx')] })

      // Act
      const path = await service.findClaudeBinary()

      // Assert
      expect(path).toBe(fakeClaude)
    })

    it('should error when binary not found', async () => {
      // Arrange: empty PATH and empty NPX cache
      // 兜底扫描注入空表：硬编码路径表会扫真实 home，本机装了原生 claude 时该用例会被环境左右，
      // 注入后断言只依赖"三处都没有"，与机器状态解耦
      process.env.PATH = tempDir
      const service = new DiscoveryService({
        npxCacheDirs: [join(tempDir, 'empty')],
        installationScanner: async () => []
      })

      // Act & Assert
      let caught: CcxError | undefined
      try {
        await service.findClaudeBinary()
      } catch (e) {
        caught = e as CcxError
      }

      expect(caught).toBeInstanceOf(CcxError)
      expect(caught?.code).toBe(ErrorCode.BINARY_NOT_FOUND)
    })
  })

  describe('getBinaryVersion()', () => {
    it('should extract version from --version output', async () => {
      // Arrange: create a fake binary that outputs version
      const fakeClaude = join(tempDir, 'claude')
      writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.161 (Claude Code)"')
      chmodSync(fakeClaude, 0o755)

      const service = new DiscoveryService()

      // Act
      const version = await service.getBinaryVersion(fakeClaude)

      // Assert
      expect(version).toBe('2.1.161')
    })

    it('should return unknown for unexpected format', async () => {
      const fakeClaude = join(tempDir, 'claude')
      writeFileSync(fakeClaude, '#!/bin/bash\necho "hello world"')
      chmodSync(fakeClaude, 0o755)

      const service = new DiscoveryService()
      const version = await service.getBinaryVersion(fakeClaude)

      expect(version).toBe('unknown')
    })
  })
})
