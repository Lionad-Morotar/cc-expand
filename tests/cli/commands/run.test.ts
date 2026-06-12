import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../../../src/cli/commands/run.js'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const { EventEmitter } = await import('node:events')
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
      return new EventEmitter()
    }),
  }
})

describe('run command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-run-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createBinary(name: string) {
    const binDir = join(tempDir, '.cc-expand', 'bin')
    mkdirSync(binDir, { recursive: true })
    const path = join(binDir, name)
    writeFileSync(path, '#!/bin/sh\necho ok')
    chmodSync(path, 0o755)
  }

  it('parses k suffix in token argument', async () => {
    createBinary('claude-270000')
    await expect(runCommand('270k')).resolves.toBeUndefined()
  })

  it('parses w suffix in token argument', async () => {
    createBinary('claude-270000')
    await expect(runCommand('27w')).resolves.toBeUndefined()
  })

  it('defaults to 270000 when no argument provided', async () => {
    createBinary('claude-270000')
    await expect(runCommand()).resolves.toBeUndefined()
  })

  it('rejects invalid token argument', async () => {
    await expect(runCommand('abc')).rejects.toThrow('Invalid target tokens')
  })
})
