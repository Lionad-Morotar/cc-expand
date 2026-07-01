import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PatternUploader, type UploadClient } from '../../scripts/pattern-uploader.js'

describe('PatternUploader', () => {
  let tmpDir: string
  let cachePath: string
  let putMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-expand-uploader-'))
    cachePath = join(tmpDir, 'cache.json')
    putMock = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const makeUploader = (client?: Partial<UploadClient>) =>
    new PatternUploader({ client: client ?? { put: putMock }, cachePath })

  const writeLocalFile = (name: string, content: string): string => {
    const filePath = join(tmpDir, name)
    writeFileSync(filePath, content)
    return filePath
  }

  const md5 = (content: string): string =>
    createHash('md5').update(content).digest('hex')

  describe('uploadFile()', () => {
    it('缓存命中且内容未变时跳过上传，不调用 OSS', async () => {
      // Arrange: 本地文件 + 预置缓存命中其 hash
      const filePath = writeLocalFile('2.1.186.json', '{"version":"2.1.186"}')
      writeFileSync(cachePath, JSON.stringify({ [filePath]: md5('{"version":"2.1.186"}') }))

      const uploader = makeUploader()

      // Act
      const outcome = await uploader.uploadFile(filePath)

      // Assert
      expect(outcome).toBe('skipped')
      expect(putMock).not.toHaveBeenCalled()
    })

    it('缓存无记录时上传到 OSS 并把 hash 写入缓存文件', async () => {
      // Arrange: 本地文件存在，缓存为空
      const content = '{"version":"2.1.187"}'
      const filePath = writeLocalFile('2.1.187.json', content)

      const uploader = makeUploader()

      // Act
      const outcome = await uploader.uploadFile(filePath)

      // Assert: 实际调用了 OSS put，对象 key 带前缀 + basename
      expect(outcome).toBe('uploaded')
      expect(putMock).toHaveBeenCalledTimes(1)
      expect(putMock).toHaveBeenCalledWith('patterns/2.1.187.json', filePath)

      // Assert: hash 已落盘，下次启动可命中
      const persisted = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, string>
      expect(persisted[filePath]).toBe(md5(content))
    })

    it('缓存记录的 hash 与当前内容不符时重新上传并更新缓存', async () => {
      // Arrange: 缓存存的是旧内容 hash，本地文件已被 pattern-gen 覆盖为新内容
      const oldContent = '{"version":"2.1.188"}'
      const newContent = '{"version":"2.1.189"}'
      const filePath = writeLocalFile('2.1.188.json', newContent)
      writeFileSync(cachePath, JSON.stringify({ [filePath]: md5(oldContent) }))

      const uploader = makeUploader()

      // Act
      const outcome = await uploader.uploadFile(filePath)

      // Assert: 重新上传 + 缓存更新为新 hash（旧 hash 被覆盖）
      expect(outcome).toBe('uploaded')
      expect(putMock).toHaveBeenCalledWith('patterns/2.1.188.json', filePath)
      const persisted = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, string>
      expect(persisted[filePath]).toBe(md5(newContent))
    })

    it('缓存文件不存在时视为空缓存，正常上传', async () => {
      // Arrange: 故意不创建 cachePath
      const content = '{"version":"2.1.190"}'
      const filePath = writeLocalFile('2.1.190.json', content)

      const uploader = makeUploader()

      // Act: 构造与上传都不应崩
      const outcome = await uploader.uploadFile(filePath)

      // Assert
      expect(outcome).toBe('uploaded')
      expect(putMock).toHaveBeenCalledTimes(1)
    })

    it('缓存文件内容损坏时降级为空缓存，不抛异常', async () => {
      // Arrange: 缓存文件是非法 JSON
      const content = '{"version":"2.1.191"}'
      const filePath = writeLocalFile('2.1.191.json', content)
      writeFileSync(cachePath, '<<<not-valid-json>>>')

      // Act: 构造时读损坏缓存不应抛 SyntaxError
      const uploader = makeUploader()
      const outcome = await uploader.uploadFile(filePath)

      // Assert: 当作空缓存，正常上传
      expect(outcome).toBe('uploaded')
      expect(putMock).toHaveBeenCalledWith('patterns/2.1.191.json', filePath)
    })

    it('上传失败时按重试策略重试，最终成功后写入缓存', async () => {
      // Arrange: 前 3 次失败，第 4 次成功（1 次初始 + 3 次重试）
      const content = '{"version":"2.1.192"}'
      const filePath = writeLocalFile('2.1.192.json', content)
      putMock
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(undefined)

      // retryDelay 注入 0，避免测试等待真实指数退避
      const uploader = new PatternUploader({
        client: { put: putMock },
        cachePath,
        retryDelay: () => 0
      })

      // Act
      const outcome = await uploader.uploadFile(filePath)

      // Assert: 共尝试 4 次，最终成功并写缓存
      expect(outcome).toBe('uploaded')
      expect(putMock).toHaveBeenCalledTimes(4)
      const persisted = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, string>
      expect(persisted[filePath]).toBe(md5(content))
    })

    it('重试耗尽仍失败时返回 failed 且不写入缓存', async () => {
      // Arrange: 永久失败
      const content = '{"version":"2.1.193"}'
      const filePath = writeLocalFile('2.1.193.json', content)
      putMock.mockRejectedValue(new Error('permanent'))

      const uploader = new PatternUploader({
        client: { put: putMock },
        cachePath,
        retryLimit: 2,
        retryDelay: () => 0
      })

      // Act
      const outcome = await uploader.uploadFile(filePath)

      // Assert: 1 次初始 + 2 次重试 = 3 次；失败不落盘缓存
      expect(outcome).toBe('failed')
      expect(putMock).toHaveBeenCalledTimes(3)
      expect(existsSync(cachePath)).toBe(false)
    })
  })
})
