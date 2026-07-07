/**
 * TDD Slice B + G: UpdateCheckService — 更新检查深度模块
 *
 * 封装节流、版本查询（走用户 npm registry）、semver 比较、静默失败、atomic write。
 * 通过 cachePath / versionResolver / currentVersion 依赖注入隔离外部依赖，
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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-update-check-'))
    cachePath = join(tempDir, 'update-check.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('无缓存且 resolver 返回更新版本时返回 hasUpdate=true', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => '0.3.1'
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1',
      channel: 'latest'
    })
  })

  it('节流命中（state 在 intervalMs 内）时不查 resolver，用缓存比较', async () => {
    const state = {
      lastCheckedAt: new Date().toISOString(),
      lastKnownLatest: '0.3.1'
    }
    writeFileSync(cachePath, JSON.stringify(state))

    const resolver = vi.fn()
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: resolver
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1',
      channel: 'latest'
    })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('resolver 返回 undefined（查询失败）时静默返回 null', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => undefined
    })
    const result = await service.check()

    expect(result).toBeNull()
  })

  it('resolver 抛错时静默返回 null', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => {
        throw new Error('network')
      }
    })
    const result = await service.check()

    expect(result).toBeNull()
  })

  it('resolver 返回相同版本时 hasUpdate=false', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => '0.3.0'
    })
    const result = await service.check()

    expect(result).toEqual({
      hasUpdate: false,
      currentVersion: '0.3.0',
      latestVersion: '0.3.0',
      channel: 'latest'
    })
  })

  it('成功检查后写回 state（lastKnownLatest + lastCheckedAt）', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => '0.3.1'
    })
    await service.check()

    const raw = readFileSync(cachePath, 'utf-8')
    const state = JSON.parse(raw)
    expect(state.lastKnownLatest).toBe('0.3.1')
    // lastCheckedAt 是合法 ISO 时间戳
    expect(new Date(state.lastCheckedAt).getTime()).not.toBeNaN()
  })

  it('节流文件损坏时忽略缓存，正常查 resolver', async () => {
    writeFileSync(cachePath, 'not-valid-json')

    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => '0.3.1'
    })
    const result = await service.check()

    expect(result?.hasUpdate).toBe(true)
  })

  it('resolver 返回非法 version 时静默返回 null', async () => {
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: async () => 'not-a-version'
    })
    const result = await service.check()

    expect(result).toBeNull()
  })

  it('skipCache=true 时忽略新鲜缓存，强制查 resolver 真实最新版', async () => {
    // 预置新鲜缓存：缓存的 latest 与 current 相同（缓存比较会得 hasUpdate=false）
    const state = {
      lastCheckedAt: new Date().toISOString(),
      lastKnownLatest: '0.3.0'
    }
    writeFileSync(cachePath, JSON.stringify(state))

    // 但 resolver 实际返回 0.3.1（缓存过时）
    const resolver = vi.fn(async () => '0.3.1')
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.3.0',
      versionResolver: resolver
    })
    // skipCache 绕过节流，强制查真实 0.3.1
    const result = await service.check({ skipCache: true })

    expect(resolver).toHaveBeenCalled()
    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1',
      channel: 'latest'
    })
  })

  it('prerelease currentVersion → channel alpha，按对应通道比较', async () => {
    const resolver = vi.fn(async () => '0.4.0-alpha.2')
    const service = new UpdateCheckService({
      cachePath,
      currentVersion: '0.4.0-alpha.1',
      versionResolver: resolver
    })
    const result = await service.check()
    expect(result).toEqual({
      hasUpdate: true,
      currentVersion: '0.4.0-alpha.1',
      latestVersion: '0.4.0-alpha.2',
      channel: 'alpha'
    })
  })
})
