import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { patchCommand } from '../../../src/cli/commands/patch.js'

describe('patch command argument validation', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-patch-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should reject --target without value', async () => {
    await expect(patchCommand(['--target'])).rejects.toThrow(
      '--target requires a valid positive integer',
    )
  })

  it('should reject non-numeric --target', async () => {
    await expect(patchCommand(['--target', 'abc'])).rejects.toThrow(
      '--target requires a valid positive integer',
    )
  })

  it('should reject --target with zero', async () => {
    await expect(patchCommand(['--target', '0'])).rejects.toThrow(
      'Invalid target tokens',
    )
  })

  it('should reject --target with negative number', async () => {
    await expect(patchCommand(['--target', '-1'])).rejects.toThrow(
      '--target requires a valid positive integer',
    )
  })

  it('should reject --version without value', async () => {
    await expect(patchCommand(['--version'])).rejects.toThrow(
      '--version requires a value',
    )
  })

  it('should reject --version followed by another flag', async () => {
    await expect(patchCommand(['--version', '--yes'])).rejects.toThrow(
      '--version requires a value',
    )
  })
})
