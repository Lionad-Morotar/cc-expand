import { describe, it, expect } from 'vitest'
import { LatestChecker } from '../../src/services/latest-checker.js'

describe('LatestChecker', () => {
  describe('check()', () => {
    // B13: latest 已在本地已处理列表中 → 无需工作
    it('returns needWork=false when latest is already processed locally', () => {
      const result = new LatestChecker().check('2.1.178', ['2.1.177', '2.1.178'])

      expect(result.latest).toBe('2.1.178')
      expect(result.needWork).toBe(false)
      expect(result.processed).toEqual(['2.1.177', '2.1.178'])
    })

    // B14: latest 不在本地 → 需要生成 pattern
    it('returns needWork=true when latest is missing from local versions', () => {
      const result = new LatestChecker().check('2.1.179', ['2.1.177', '2.1.178'])

      expect(result.needWork).toBe(true)
    })

    // B15: 跨版本跃迁(local 最高远低于 latest)仍正确识别需要工作
    it('returns needWork=true for a version jump (latest far ahead of local)', () => {
      const result = new LatestChecker().check('2.1.180', ['2.1.160', '2.1.161'])

      expect(result.needWork).toBe(true)
      expect(result.processed).toEqual(['2.1.160', '2.1.161'])
    })
  })
})
