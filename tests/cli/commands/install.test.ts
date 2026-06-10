import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCommand } from '../../../src/cli/commands/install.js'

describe('install command', () => {
  let tempDir: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-install-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('should report already installed if binary exists', async () => {
    // 创建假的已安装目录结构
    const versionDir = join(tempDir, '.cc-expand', 'packages', '2.1.170')
    mkdirSync(join(versionDir, 'bin'), { recursive: true })
    writeFileSync(join(versionDir, 'bin', 'claude'), 'fake-binary')

    await installCommand(['2.1.170'], {
      homeDir: tempDir,
    } as any)

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already installed'))
  })
})
