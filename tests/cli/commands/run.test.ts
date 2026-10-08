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
    createBinary('claude-27w')
    const child = fakeChild()
    const promise = runCommand('270k', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('parses w suffix in token argument', async () => {
    createBinary('claude-27w')
    const child = fakeChild()
    const promise = runCommand('27w', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('defaults to 280000 when no argument provided', async () => {
    createBinary('claude-28w')
    const child = fakeChild()
    const promise = runCommand(undefined, { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(280000)
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
    createBinary('claude-27w')
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
    createBinary('claude-27w')
    const child = fakeChild()
    const promise = runCommand('270k', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 1)
    const result = await promise

    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(false)
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('resolves explicit combo argument (27w-flow) directly (CR#10)', async () => {
    createBinary('claude-27w-flow')
    const child = fakeChild()
    const promise = runCommand('27w-flow', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(true)
    expect((result as { data?: { targetTokens: number } }).data?.targetTokens).toBe(270000)
  })

  it('normalizes uncanonical combo (270k-flow → 27w-flow) (CR#10)', async () => {
    createBinary('claude-27w-flow')
    const child = fakeChild()
    const promise = runCommand('270k-flow', { exitOnChildExit: false, spawn: () => child })
    child.emit('exit', 0)
    const result = await promise
    expect(result).toBeDefined()
    expect((result as { success: boolean }).success).toBe(true)
  })

  it('rejects combo with invalid token segment (CR#10)', async () => {
    await expect(runCommand('abc-flow')).rejects.toThrow('Invalid target tokens')
  })

  it('--print-binary outputs binary path and does not spawn', async () => {
    createBinary('claude-27w')
    const logs: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => logs.push(msg)
    try {
      const result = await runCommand('270k', { printBinary: true })
      expect(result).toBeDefined()
      expect((result as { success: boolean }).success).toBe(true)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatch(/claude-27w$/)
    } finally {
      console.log = originalLog
    }
  })

  describe('variant fallback（精确 combo 缺失时回落到唯一插件变体）', () => {
    it('falls back to the only plugin variant when exact combo binary is missing', async () => {
      // 场景：silence 插件启用后 patch 产物是 claude-32w-sil，shell 快捷方式只有 token 段
      createBinary('claude-32w-sil')
      const child = fakeChild()
      const promise = runCommand('320000', { exitOnChildExit: false, spawn: () => child })
      child.emit('exit', 0)
      const result = await promise

      expect((result as { success: boolean }).success).toBe(true)
      expect((result as { data?: { binaryPath: string } }).data?.binaryPath).toMatch(/claude-32w-sil$/)
    })

    it('falls back in --print-binary mode and keeps stdout path-only（cc() 消费方契约）', async () => {
      createBinary('claude-32w-sil')
      const logs: string[] = []
      const errs: string[] = []
      const originalLog = console.log
      const originalErr = console.error
      console.log = (msg: string) => logs.push(msg)
      console.error = (msg: string) => errs.push(msg)
      try {
        const result = await runCommand('320000', { printBinary: true })
        expect((result as { success: boolean }).success).toBe(true)
        expect(logs).toHaveLength(1)
        expect(logs[0]).toMatch(/claude-32w-sil$/)
        expect(errs.join('\n')).toContain('claude-32w-sil')
      } finally {
        console.log = originalLog
        console.error = originalErr
      }
    })

    it('errors listing candidates when multiple variants exist（语义不明不猜测）', async () => {
      createBinary('claude-32w-sil')
      createBinary('claude-32w-flow')
      const result = await runCommand('320000')

      expect((result as { success: boolean }).success).toBe(false)
      expect((result as { error?: { code: string } }).error?.code).toBe('BINARY_NOT_FOUND')
      expect((result as { error?: { message: string } }).error?.message).toContain('claude-32w-flow')
      expect((result as { error?: { message: string } }).error?.message).toContain('claude-32w-sil')
    })

    it('does not fall back across token segments sharing a prefix（32w ≠ 32w1k）', async () => {
      createBinary('claude-32w1k')
      const result = await runCommand('320000')

      expect((result as { success: boolean }).success).toBe(false)
    })
  })
})
