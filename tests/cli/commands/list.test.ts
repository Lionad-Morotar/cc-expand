import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCommand } from '../../../src/cli/commands/list.js'

describe('list command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-list-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createInstalledVersion(version: string) {
    const binDir = join(tempDir, '.cc-expand', 'packages', version, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'claude'), 'fake-binary')
  }

  function createPatchedVersions(
    versions: Record<string, { targets: number[]; patchedAt: string }>,
  ) {
    const configPath = join(tempDir, '.cc-expand', 'versions.json')
    mkdirSync(join(tempDir, '.cc-expand'), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ patchedVersions: versions }, null, 2))
  }

  it('lists installed versions sorted by semver descending', async () => {
    createInstalledVersion('2.1.170')
    createInstalledVersion('2.1.161')

    const result = await listCommand([], { latestResolver: async () => '2.1.160' })

    expect(result.success).toBe(true)
    expect(result.data?.versions.map((v) => v.version)).toEqual(['2.1.170', '2.1.161'])
    expect(result.data?.versions.every((v) => v.installed)).toBe(true)
  })

  it('marks patched versions correctly', async () => {
    createInstalledVersion('2.1.170')
    createInstalledVersion('2.1.161')
    createPatchedVersions({
      '2.1.170': { targets: [270000], patchedAt: '2026-06-10T00:00:00.000Z' },
    })

    const result = await listCommand([], { latestResolver: async () => '2.1.160' })

    const v170 = result.data?.versions.find((v) => v.version === '2.1.170')
    const v161 = result.data?.versions.find((v) => v.version === '2.1.161')
    expect(v170?.patched).toBe(true)
    expect(v170?.targets).toEqual([270000])
    expect(v161?.patched).toBe(false)
  })

  it('filters with --patched', async () => {
    createInstalledVersion('2.1.170')
    createInstalledVersion('2.1.161')
    createPatchedVersions({
      '2.1.170': { targets: [270000], patchedAt: '2026-06-10T00:00:00.000Z' },
    })

    const result = await listCommand(['--patched'], { latestResolver: async () => '2.1.160' })

    expect(result.data?.versions).toHaveLength(1)
    expect(result.data?.versions[0]?.version).toBe('2.1.170')
  })

  it('includes only patched versions when none installed', async () => {
    createPatchedVersions({
      '2.1.170': { targets: [270000], patchedAt: '2026-06-10T00:00:00.000Z' },
    })

    const result = await listCommand([], { latestResolver: async () => '2.1.160' })

    expect(result.data?.versions).toHaveLength(1)
    expect(result.data?.versions[0]?.installed).toBe(false)
    expect(result.data?.versions[0]?.patched).toBe(true)
  })

  it('suggests migration when a patched version exists and latest is newer', async () => {
    createPatchedVersions({
      '2.1.177': { targets: [1000000], patchedAt: '2026-06-15T00:00:00.000Z' },
    })

    const result = await listCommand([], { latestResolver: async () => '2.1.178' })

    expect(result.next).toEqual([
      'ccx migration latest',
      'ccx patch remove 2.1.177 1m'
    ])
  })

  it('does not suggest migration when no patched versions exist', async () => {
    createInstalledVersion('2.1.177')

    const result = await listCommand([], { latestResolver: async () => '2.1.178' })

    expect(result.next).toBeUndefined()
  })

  it('shows remove hint even when no migration is suggested', async () => {
    createPatchedVersions({
      '2.1.177': { targets: [270000], patchedAt: '2026-06-15T00:00:00.000Z' },
    })

    const result = await listCommand([], { latestResolver: async () => '2.1.177' })

    expect(result.next).toEqual(['ccx patch remove 2.1.177 27w'])
  })

  it('prefers combos over legacy targets in display data', async () => {
    const configPath = join(tempDir, '.cc-expand', 'versions.json')
    mkdirSync(join(tempDir, '.cc-expand'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        patchedVersions: {
          '2.1.186': { targets: [270000], combos: ['27w-flow'], patchedAt: 'x' }
        }
      }, null, 2)
    )

    const result = await listCommand([], { latestResolver: async () => '2.1.160' })

    const v186 = result.data?.versions.find(v => v.version === '2.1.186')
    expect(v186?.combos).toEqual(['27w-flow'])
  })
})
