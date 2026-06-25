import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatchCleanupService } from '../../src/services/patch-cleanup.js'

describe('PatchCleanupService', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-cleanup-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  function binaryPath(combo: string): string {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return join(tempDir, '.cc-expand', 'bin', `claude-${combo}${ext}`)
  }

  function createBinary(combo: string): void {
    const path = binaryPath(combo)
    mkdirSync(join(tempDir, '.cc-expand', 'bin'), { recursive: true })
    writeFileSync(path, 'fake-binary')
  }

  it('removes an existing patched binary', () => {
    createBinary('27w')
    const service = new PatchCleanupService()

    const result = service.remove('27w')

    expect(result.removed).toBe(true)
    expect(existsSync(binaryPath('27w'))).toBe(false)
  })

  it('returns warning when binary does not exist', () => {
    const service = new PatchCleanupService()

    const result = service.remove('missing')

    expect(result.removed).toBe(false)
    expect(result.warning).toContain('not found')
  })

  it('returns warning when bin directory does not exist', () => {
    const service = new PatchCleanupService()

    const result = service.remove('27w')

    expect(result.removed).toBe(false)
    expect(result.warning).toBeDefined()
  })
})
