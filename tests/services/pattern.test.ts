import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatternService } from '../../src/services/pattern.js'

describe('PatternService', () => {
  let cacheDir: string
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'cc-expand-pattern-'))
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
    globalThis.fetch = originalFetch
  })

  describe('fetchVersionsIndex()', () => {
    it('网络失败且本地有缓存时返回缓存', async () => {
      // Arrange: 预先写入缓存
      const cachedIndex = [
        { version: '2.1.161', platforms: ['darwin-arm64'] },
      ]
      writeFileSync(join(cacheDir, 'versions.json'), JSON.stringify(cachedIndex))
      writeFileSync(join(cacheDir, 'versions.etag'), '"old-etag"')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionsIndex()

      // Assert: 返回本地缓存
      expect(result).toEqual(cachedIndex)
    })

    it('网络失败且无缓存时返回空数组', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      const result = await service.fetchVersionsIndex()
      expect(result).toEqual([])
    })
  })

  describe('fetchVersionPattern()', () => {
    it('网络失败时打印警告日志并返回缓存', async () => {
      const cachedPattern = {
        darwin: {
          arm64: [
            { search: 'FALLBACK=200000', desc: 'FALLBACK_PATTERN', sourceValue: '200000' },
          ],
        },
      }
      writeFileSync(join(cacheDir, '2.1.173.json'), JSON.stringify(cachedPattern))
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"fallback-etag"')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS lookup failed'))

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      const result = await service.fetchVersionPattern('2.1.173')

      expect(result).toEqual(cachedPattern)
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('baseUrl 无尾斜杠时也能正确拼接 URL', async () => {
      const mockPattern: Record<string, unknown> = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          ],
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([['etag', '"abc123"']]),
        json: async () => mockPattern,
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns', // 无尾斜杠
      })

      await service.fetchVersionPattern('2.1.173')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.example.com/patterns/2.1.173.json',
        expect.anything(),
      )
    })

    it('恶意 version 字符串被拦截，不发起请求', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([['etag', '"abc123"']]),
        json: async () => ({ darwin: { arm64: [] } }),
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      const result = await service.fetchVersionPattern('../../../evil')
      expect(result).toBeUndefined()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('无缓存时从远程拉取并写入本地缓存', async () => {
      // Arrange: mock fetch 返回 200 + pattern 数据 + ETag
      const mockPattern: Record<string, unknown> = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          ],
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([['etag', '"abc123"']]),
        json: async () => mockPattern,
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 返回正确的数据
      expect(result).toEqual(mockPattern)

      // Assert: 缓存文件已写入
      const cacheFile = join(cacheDir, '2.1.173.json')
      expect(existsSync(cacheFile)).toBe(true)
      expect(JSON.parse(readFileSync(cacheFile, 'utf-8'))).toEqual(mockPattern)

      // Assert: etag 文件已写入
      const etagFile = join(cacheDir, '2.1.173.etag')
      expect(existsSync(etagFile)).toBe(true)
      expect(readFileSync(etagFile, 'utf-8')).toBe('"abc123"')
    })

    it('有缓存且服务器返回 304 时返回本地缓存', async () => {
      // Arrange: 预先写入缓存
      const cachedPattern = {
        darwin: {
          arm64: [
            { search: 'OLD=200000', desc: 'OLD_PATTERN', sourceValue: '200000' },
          ],
        },
      }
      writeFileSync(join(cacheDir, '2.1.173.json'), JSON.stringify(cachedPattern))
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"old-etag"')

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 304,
        headers: new Map(),
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 返回本地缓存（不是远程新数据）
      expect(result).toEqual(cachedPattern)

      // Assert: 请求带上了 If-None-Match
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.example.com/patterns/2.1.173.json',
        expect.objectContaining({
          headers: { 'If-None-Match': '"old-etag"' },
        }),
      )
    })

    it('网络失败且本地有缓存时返回缓存', async () => {
      // Arrange: 预先写入缓存
      const cachedPattern = {
        darwin: {
          arm64: [
            { search: 'FALLBACK=200000', desc: 'FALLBACK_PATTERN', sourceValue: '200000' },
          ],
        },
      }
      writeFileSync(join(cacheDir, '2.1.173.json'), JSON.stringify(cachedPattern))
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"fallback-etag"')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 返回本地缓存作为降级
      expect(result).toEqual(cachedPattern)
    })

    it('网络失败且无本地缓存时返回 undefined', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 无缓存可降级，返回 undefined
      expect(result).toBeUndefined()
    })

    it('缓存文件损坏时返回 undefined，不崩溃', async () => {
      // Arrange: 写入非法 JSON 到缓存文件
      writeFileSync(join(cacheDir, '2.1.173.json'), 'not-valid-json')
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"etag"')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 缓存损坏时返回 undefined，不抛出 SyntaxError
      expect(result).toBeUndefined()
    })

    it('远程返回 200 但缓存写入失败时仍返回数据，不崩溃', async () => {
      const mockPattern: Record<string, unknown> = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          ],
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map([['etag', '"abc123"']]),
        json: async () => mockPattern,
      } as unknown as Response)

      // 创建只读子目录使 writeFileSync 失败
      const readonlyDir = join(cacheDir, 'readonly')
      mkdirSync(readonlyDir)
      chmodSync(readonlyDir, 0o444)

      const service = new PatternService({
        cacheDir: readonlyDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      // Act
      const result = await service.fetchVersionPattern('2.1.173')

      // Assert: 即使缓存写入失败，仍返回远程数据
      expect(result).toEqual(mockPattern)

      // 恢复权限以便 afterEach 清理
      chmodSync(readonlyDir, 0o755)
    })

    it('服务器返回 404 时返回 undefined，即使有旧缓存', async () => {
      // Arrange: 预先写入旧缓存
      const oldCache = {
        darwin: {
          arm64: [
            { search: 'OLD=200000', desc: 'OLD', sourceValue: '200000' },
          ],
        },
      }
      writeFileSync(join(cacheDir, '2.1.173.json'), JSON.stringify(oldCache))
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"old-etag"')

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 404,
        headers: new Map(),
        json: async () => ({ error: 'Not found' }),
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      const result = await service.fetchVersionPattern('2.1.173')
      expect(result).toBeUndefined()
    })

    it('服务器返回 500 且有缓存时降级到本地缓存', async () => {
      const cachedPattern = {
        darwin: {
          arm64: [
            { search: 'FALLBACK=200000', desc: 'FALLBACK', sourceValue: '200000' },
          ],
        },
      }
      writeFileSync(join(cacheDir, '2.1.173.json'), JSON.stringify(cachedPattern))
      writeFileSync(join(cacheDir, '2.1.173.etag'), '"fallback-etag"')

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 500,
        headers: new Map(),
        json: async () => ({ error: 'Internal server error' }),
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      const result = await service.fetchVersionPattern('2.1.173')
      expect(result).toEqual(cachedPattern)
    })

    it('服务器返回 200 但无 ETag 时不写入空 etag 文件', async () => {
      const mockPattern: Record<string, unknown> = {
        darwin: {
          arm64: [
            { search: 'Aj8=200000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' },
          ],
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map(), // 无 etag 头
        json: async () => mockPattern,
      } as unknown as Response)

      const service = new PatternService({
        cacheDir,
        baseUrl: 'https://test.example.com/patterns/',
      })

      await service.fetchVersionPattern('2.1.173')

      // .json 缓存已写入
      expect(existsSync(join(cacheDir, '2.1.173.json'))).toBe(true)
      // .etag 文件不应写入（空 ETag）
      expect(existsSync(join(cacheDir, '2.1.173.etag'))).toBe(false)

      // 再次请求时不携带 If-None-Match
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Map(),
        json: async () => mockPattern,
      } as unknown as Response)

      await service.fetchVersionPattern('2.1.173')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.example.com/patterns/2.1.173.json',
        expect.objectContaining({
          headers: {}, // 无 If-None-Match
        }),
      )
    })
  })
})
