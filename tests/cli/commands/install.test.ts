import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCommand } from '../../../src/cli/commands/install.js'
import { PackageService } from '../../../src/services/package.js'

describe('install command', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-install-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns [INFO] when binary is already installed', async () => {
    // 创建假的已安装目录结构
    const versionDir = join(tempDir, '.cc-expand', 'packages', '2.1.170')
    mkdirSync(join(versionDir, 'bin'), { recursive: true })
    writeFileSync(join(versionDir, 'bin', 'claude'), 'fake-binary')

    const output = await installCommand(['2.1.170'], {
      homeDir: tempDir,
    } as any)

    expect(output.startsWith('[INFO]')).toBe(true)
    expect(output).toContain('2.1.170')
    expect(output).toContain('已安装')
  })

  it('strips v prefix from version argument', async () => {
    // 创建假的已安装目录结构
    const versionDir = join(tempDir, '.cc-expand', 'packages', '2.1.170')
    mkdirSync(join(versionDir, 'bin'), { recursive: true })
    writeFileSync(join(versionDir, 'bin', 'claude'), 'fake-binary')

    const output = await installCommand(['v2.1.170'], {
      homeDir: tempDir,
    } as any)

    expect(output.startsWith('[INFO]')).toBe(true)
    expect(output).toContain('2.1.170')
    expect(output).toContain('已安装')
  })

  it('returns [INFO] when latest resolves to already installed version', async () => {
    // 创建假的已安装目录结构（模拟 latest 已解析为 2.1.170）
    const versionDir = join(tempDir, '.cc-expand', 'packages', '2.1.170')
    mkdirSync(join(versionDir, 'bin'), { recursive: true })
    writeFileSync(join(versionDir, 'bin', 'claude'), 'fake-binary')

    // Mock PackageService.resolveVersion 以注入版本解析行为
    const originalResolveVersion = PackageService.prototype.resolveVersion
    PackageService.prototype.resolveVersion = vi.fn().mockResolvedValue('2.1.170')

    try {
      const output = await installCommand(['latest'], {
        homeDir: tempDir,
      } as any)

      expect(output.startsWith('[INFO]')).toBe(true)
      expect(output).toContain('2.1.170')
    } finally {
      PackageService.prototype.resolveVersion = originalResolveVersion
    }
  })
})
