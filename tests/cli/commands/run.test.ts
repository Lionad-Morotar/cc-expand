import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../../../src/cli/commands/run.js'
import { EventEmitter } from 'node:events'

const mockEmitters: EventEmitter[] = []

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
      const emitter = new EventEmitter()
      mockEmitters.push(emitter)
      return emitter
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
    mockEmitters.length = 0
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
    const promise = runCommand('270k', { exitOnChildExit: false })
    mockEmitters[0]?.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('parses w suffix in token argument', async () => {
    createBinary('claude-270000')
    const promise = runCommand('27w', { exitOnChildExit: false })
    mockEmitters[0]?.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('defaults to 270000 when no argument provided', async () => {
    createBinary('claude-270000')
    const promise = runCommand(undefined, { exitOnChildExit: false })
    mockEmitters[0]?.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('returns error result for missing binary', async () => {
    const result = await runCommand('270k')

    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(false)
    expect((result as { error?: { code: string } }).error?.code).toBe('BINARY_NOT_FOUND')
  })

  it('rejects invalid token argument', async () => {
    await expect(runCommand('abc')).rejects.toThrow('Invalid target tokens')
  })
})
