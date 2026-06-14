/**
 * TDD Slice B: UpdateCheckService — 更新检查深度模块
 *
 * 封装节流、fetch npm registry、semver 比较、静默失败、atomic write。
 * 通过 cachePath / registryUrl / currentVersion 依赖注入隔离外部依赖，
 * 不触碰真实网络与真实用户配置。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UpdateCheckService } from '../../src/services/update-check.js'

describe('UpdateCheckService', () => {
  let tempDir: string
  let cachePath: string
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-update-check-'))
    cachePath = join(tempDir, 'update-check.json')
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('无缓存且 registry 返回更新版本时返回 hasUpdate=true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.3.1' }),
    } as unknown as Response)

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1',
    })
  })

  it('节流命中（state 在 intervalMs 内）时不发请求，用缓存比较', async () => {
    // 预置节流缓存：刚检查过，缓存了最新版
    const state = {
      lastCheckedAt: new Date().toISOString(),
      lastKnownLatest: '0.3.1',
    }
    writeFileSync(cachePath, JSON.stringify(state))

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetch 失败时静默返回 null', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result).toBeNull()
  })

  it('registry 返回相同版本时 hasUpdate=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.3.0' }),
    } as unknown as Response)

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: false,
      currentVersion: '0.3.0',
      latestVersion: '0.3.0',
    })
  })

  it('成功检查后写回 state（lastKnownLatest + lastCheckedAt）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.3.1' }),
    } as unknown as Response)

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    await service.check()

    const raw = readFileSync(cachePath, 'utf-8')
    const state = JSON.parse(raw)
    expect(state.lastKnownLatest).toBe('0.3.1')
    // lastCheckedAt 是合法 ISO 时间戳
    expect(new Date(state.lastCheckedAt).getTime()).not.toBeNaN()
  })

  it('节流文件损坏时忽略缓存，正常走 fetch', async () => {
    writeFileSync(cachePath, 'not-valid-json')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.3.1' }),
    } as unknown as Response)

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result?.hasUpdate).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('registry 返回非法 version 时静默返回 null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: 'not-a-version' }),
    } as unknown as Response)

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
    })
    const result = await service.check()

    expect(result).toBeNull()
  })
})
