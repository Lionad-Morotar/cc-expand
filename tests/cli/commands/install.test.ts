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

  function createFakePackage(version: string): PackageService {
    const packagesDir = join(tempDir, '.cc-expand', 'packages')
    const versionDir = join(packagesDir, version)
    mkdirSync(join(versionDir, 'bin'), { recursive: true })
    writeFileSync(join(versionDir, 'bin', 'claude'), 'fake-binary')
    return new PackageService(packagesDir)
  }

  it('returns structured result when binary is already installed', async () => {
    const service = createFakePackage('2.1.170')

    const result = await installCommand(['2.1.170'], {
      homeDir: tempDir,
      packageService: service,
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('install')
    expect(result.data?.version).toBe('2.1.170')
    expect(result.data?.alreadyInstalled).toBe(true)
  })

  it('strips v prefix from version argument', async () => {
    const service = createFakePackage('2.1.170')

    const result = await installCommand(['v2.1.170'], {
      homeDir: tempDir,
      packageService: service,
    })

    expect(result.success).toBe(true)
    expect(result.data?.version).toBe('2.1.170')
  })

  it('returns structured result when latest resolves to already installed version', async () => {
    const service = createFakePackage('2.1.170')
    const originalResolveVersion = PackageService.prototype.resolveVersion
    PackageService.prototype.resolveVersion = vi.fn().mockResolvedValue('2.1.170')

    try {
      const result = await installCommand(['latest'], {
        homeDir: tempDir,
        packageService: service,
      })

      expect(result.success).toBe(true)
      expect(result.data?.version).toBe('2.1.170')
      expect(result.data?.alreadyInstalled).toBe(true)
    } finally {
      PackageService.prototype.resolveVersion = originalResolveVersion
    }
  })
})
