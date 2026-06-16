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

  function seedPatchedHistory(version: string) {
    const configDir = join(tempDir, '.cc-expand')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'versions.json'),
      JSON.stringify({ patchedVersions: { [version]: { targets: [270000], patchedAt: '2026-06-10T00:00:00Z' } } }, null, 2),
    )
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

  it('suggests patch when there is no patch history (first setup)', async () => {
    const service = createFakePackage('2.1.178')

    const result = await installCommand(['2.1.178'], {
      homeDir: tempDir,
      packageService: service,
    })

    expect(result.success).toBe(true)
    expect(result.next).toEqual(['ccx patch --target 270000 --yes'])
  })

  it('suggests migration when patch history exists (upgrade scenario)', async () => {
    seedPatchedHistory('2.1.177')
    const service = createFakePackage('2.1.178')

    const result = await installCommand(['2.1.178'], {
      homeDir: tempDir,
      packageService: service,
    })

    expect(result.success).toBe(true)
    expect(result.next).toEqual(['ccx migration 2.1.178'])
  })
})
