/**
 * LatestCacheService — 最新版本查询的 TTL 缓存
 *
 * 隔离网络：resolver 与 cachePath 全部注入，不触碰真实 registry 与真实用户配置目录。
 * 时间源注入 now，避免用 fake timers 拖长测试或与异步断言耦合。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LatestCacheService } from '../../src/services/latest-cache.js'

describe('LatestCacheService', () => {
  let tempDir: string
  let cachePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-latest-cache-'))
    cachePath = join(tempDir, 'latest-versions.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('无缓存时调用解析器并把结果写入缓存', async () => {
    const resolver = vi.fn().mockResolvedValue('2.1.314')
    const service = new LatestCacheService({ cachePath, resolver })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBe('2.1.314')
    expect(resolver).toHaveBeenCalledOnce()

    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(cached['@anthropic-ai/claude-code'].version).toBe('2.1.314')
  })

  it('缓存未过期时直接返回缓存值，不调用解析器', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        '@anthropic-ai/claude-code': {
          checkedAt: new Date('2026-10-30T00:00:00.000Z').toISOString(),
          version: '2.1.314'
        }
      })
    )
    const resolver = vi.fn().mockResolvedValue('2.1.320')
    const service = new LatestCacheService({
      cachePath,
      resolver,
      ttlMs: 600_000,
      now: () => Date.parse('2026-10-30T00:05:00.000Z')
    })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBe('2.1.314')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('缓存过期后重新解析并覆盖缓存', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        '@anthropic-ai/claude-code': {
          checkedAt: new Date('2026-10-30T00:00:00.000Z').toISOString(),
          version: '2.1.314'
        }
      })
    )
    const resolver = vi.fn().mockResolvedValue('2.1.320')
    const service = new LatestCacheService({
      cachePath,
      resolver,
      ttlMs: 600_000,
      now: () => Date.parse('2026-10-30T00:20:00.000Z')
    })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBe('2.1.320')
    expect(resolver).toHaveBeenCalledOnce()

    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(cached['@anthropic-ai/claude-code'].version).toBe('2.1.320')
  })

  it('解析失败返回 undefined 且不写缓存，已有条目保持原样', async () => {
    const stale = {
      '@anthropic-ai/claude-code': {
        checkedAt: new Date('2026-10-30T00:00:00.000Z').toISOString(),
        version: '2.1.314'
      }
    }
    writeFileSync(cachePath, JSON.stringify(stale))
    const resolver = vi.fn().mockResolvedValue(undefined)
    const service = new LatestCacheService({
      cachePath,
      resolver,
      ttlMs: 600_000,
      now: () => Date.parse('2026-10-30T00:20:00.000Z')
    })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBeUndefined()
    expect(JSON.parse(readFileSync(cachePath, 'utf-8'))).toEqual(stale)
  })

  it('解析器抛错时静默返回 undefined', async () => {
    const service = new LatestCacheService({
      cachePath,
      resolver: async () => {
        throw new Error('network')
      }
    })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBeUndefined()
  })

  it('ttlMs <= 0 时禁用缓存，每次直查解析器', async () => {
    const resolver = vi.fn().mockResolvedValue('2.1.314')
    const service = new LatestCacheService({ cachePath, resolver, ttlMs: 0 })

    await service.getLatest('@anthropic-ai/claude-code')
    await service.getLatest('@anthropic-ai/claude-code')

    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('缓存文件损坏时按无缓存处理，不抛错', async () => {
    writeFileSync(cachePath, '{ not json')
    const resolver = vi.fn().mockResolvedValue('2.1.314')
    const service = new LatestCacheService({ cachePath, resolver })

    await expect(service.getLatest('@anthropic-ai/claude-code')).resolves.toBe('2.1.314')
    expect(JSON.parse(readFileSync(cachePath, 'utf-8'))['@anthropic-ai/claude-code'].version).toBe(
      '2.1.314'
    )
  })

  it('不同包名各自独立缓存，互不覆盖', async () => {
    const resolver = vi.fn(async (name: string) => (name === 'cc-expand' ? '0.6.1' : '2.1.314'))
    const service = new LatestCacheService({ cachePath, resolver })

    await service.getLatest('cc-expand')
    await service.getLatest('@anthropic-ai/claude-code')
    await service.getLatest('cc-expand')

    expect(resolver).toHaveBeenCalledTimes(2)
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(cached['cc-expand'].version).toBe('0.6.1')
    expect(cached['@anthropic-ai/claude-code'].version).toBe('2.1.314')
  })
})
