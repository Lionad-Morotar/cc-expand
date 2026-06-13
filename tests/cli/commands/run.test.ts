import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { runCommand } from '../../../src/cli/commands/run.js'

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

  /** 构造一个可作为注入 spawn 返回值的 EventEmitter，伪装成 ChildProcess */
  function fakeChild(): ChildProcess {
    return new EventEmitter() as unknown as ChildProcess
  }

  it('parses k suffix in token argument', async () => {
    createBinary('claude-270000')
    const child = fakeChild()
    const promise = runCommand('270k', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('parses w suffix in token argument', async () => {
    createBinary('claude-270000')
    const child = fakeChild()
    const promise = runCommand('27w', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('defaults to 270000 when no argument provided', async () => {
    createBinary('claude-270000')
    const child = fakeChild()
    const promise = runCommand(undefined, { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('returns error result for missing binary', async () => {
    // 不创建 binary，runCommand 在 existsSync 检查时直接返回错误，不调用 spawn
    const result = await runCommand('270k')

    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(false)
    expect((result as { error?: { code: string } }).error?.code).toBe('BINARY_NOT_FOUND')
  })

  it('rejects invalid token argument', async () => {
    await expect(runCommand('abc')).rejects.toThrow('Invalid target tokens')
  })

  it('returns error result when child emits error event (spawn failure)', async () => {
    createBinary('claude-270000')
    const child = fakeChild()
    const promise = runCommand('270k', { exitOnChildExit: false, spawn: () => child })
    // 模拟 binary 存在但无法 spawn：权限不足、codesign 损坏、架构不匹配
    child.emit('error', new Error('EACCES: permission denied'))
    const result = await promise

    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(false)
    expect((result as { error?: { code: string } }).error?.code).toBe('BINARY_NOT_FOUND')
    expect((result as { error?: { message: string } }).error?.message).toContain('permission denied')
  })

  it('resolves with success=false when child exits non-zero', async () => {
    createBinary('claude-270000')
    const child = fakeChild()
    const promise = runCommand('270k', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 1)
    const result = await promise

    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(false)
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })
})
