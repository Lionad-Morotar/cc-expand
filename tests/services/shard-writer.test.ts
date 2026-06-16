import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ShardWriter } from '../../src/services/shard-writer.js'
import type { OsPatterns } from '../../src/services/pattern.js'

function tmpPatternsDir(): string {
  return mkdtempSync(join(tmpdir(), 'shard-writer-'))
}

describe('ShardWriter', () => {
  // B10: writeShard 写出扁平 OsPatterns 结构的 patterns/{version}.json
  describe('writeShard()', () => {
    it('writes patterns/{version}.json in flat OsPatterns structure', () => {
      const dir = tmpPatternsDir()
      const patterns: OsPatterns = {
        darwin: {
          arm64: [{ search: 'AP_=200000,YP_=20000', desc: 'MODEL_CONTEXT_WINDOW_DEFAULT', sourceValue: '200000' }],
        },
      }

      const writer = new ShardWriter({ patternsDir: dir })
      const path = writer.writeShard('2.1.200', patterns)

      expect(path).toBe(join(dir, '2.1.200.json'))
      const written = JSON.parse(readFileSync(path, 'utf8'))
      expect(written).toEqual(patterns)
    })
  })

  // B11/B12: upsertVersionIndex 幂等更新版本索引
  describe('upsertVersionIndex()', () => {
    it('appends new version entries to versions.json', () => {
      const dir = tmpPatternsDir()
      const writer = new ShardWriter({ patternsDir: dir })

      writer.upsertVersionIndex('2.1.200', ['darwin-arm64'])
      writer.upsertVersionIndex('2.1.201', ['darwin-arm64', 'darwin-x64'])

      const items = JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf8'))
      expect(items).toEqual([
        { version: '2.1.200', platforms: ['darwin-arm64'] },
        { version: '2.1.201', platforms: ['darwin-arm64', 'darwin-x64'] },
      ])
    })

    it('is idempotent: upserting an existing version updates platforms without duplicating', () => {
      const dir = tmpPatternsDir()
      const writer = new ShardWriter({ patternsDir: dir })

      writer.upsertVersionIndex('2.1.200', ['darwin-arm64'])
      writer.upsertVersionIndex('2.1.200', ['darwin-arm64', 'darwin-x64', 'win32-x64'])

      const items = JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf8'))
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        version: '2.1.200',
        platforms: ['darwin-arm64', 'darwin-x64', 'win32-x64'],
      })
    })
  })
})
