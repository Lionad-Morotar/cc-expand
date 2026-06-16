import { describe, it, expect } from 'vitest'
import { PatternDiscovery } from '../../src/core/pattern-discovery.js'
import { CcxError, ErrorCode } from '../../src/types/index.js'

// 用分号分隔片段,模拟真实 minified 二进制中变量名前的符号边界
// (下划线会连接字母被正则误吞为变量名前缀,故用符号分隔)
const FIXTURE =
  'hdr;AP_=200000,YP_=20000;u6O=200000,m6O=1536;Z07=200000,Gh=50;xj3=200000,I8q=3;OpK=200000,N9q=3,v9q=3;K)>200000:!1};trl'

describe('PatternDiscovery', () => {
  describe('discover()', () => {
    // B1 [tracer bullet]: 5 个 =200000 锚点 + 1 个 exceeds 阈值 → 恰好 6 条 search
    it('produces exactly 6 search strings for a buffer with 5 anchors and an exceeds threshold', () => {
      const buffer = Buffer.from(FIXTURE, 'latin1')

      const result = new PatternDiscovery().discover(buffer)

      expect(result).toHaveLength(6)
    })

    // B3: 排除 20000000(8位零)噪声锚点,不被误判为上下文窗口模式
    it('excludes 20000000 noise anchors so they are not mistaken for context-window patterns', () => {
      const buffer = Buffer.from('hdr;g0_=20000000;' + FIXTURE.slice(4), 'latin1')

      const result = new PatternDiscovery().discover(buffer)

      expect(result).toHaveLength(6)
    })

    // B4: 贪婪多字段——产出带伴生字段的 search,抗未来版本变量名复用漂移
    it('produces search strings with companion fields (greedy multi-field)', () => {
      const buffer = Buffer.from(FIXTURE, 'latin1')

      const searches = new PatternDiscovery().discover(buffer).map((p) => p.search)

      expect(searches).toContain('AP_=200000,YP_=20000')
      expect(searches).toContain('OpK=200000,N9q=3,v9q=3')
    })

    // B2: 每条产出 search 在 buffer 中唯一(count===1),这是 patch 定位正确的充要条件
    it('produces search strings that are each unique within the buffer', () => {
      const buffer = Buffer.from(FIXTURE, 'latin1')
      const text = buffer.toString('latin1')

      const result = new PatternDiscovery().discover(buffer)

      for (const { search } of result) {
        expect(text.split(search).length - 1).toBe(1)
      }
    })

    // B6: =200000 锚点数 ≠ 5(结构突变,如模式增减)时抛 PATTERN_DISCOVERY_FAILED
    it('throws PATTERN_DISCOVERY_FAILED when anchor count is not 5', () => {
      const buffer = Buffer.from(
        'hdr;AP_=200000,YP_=20000;u6O=200000,m6O=1536;Z07=200000,Gh=50;xj3=200000,Ij_=3;K)>200000:!1};trl',
        'latin1',
      )

      expect(() => new PatternDiscovery().discover(buffer)).toThrow(CcxError)
      try {
        new PatternDiscovery().discover(buffer)
      } catch (e) {
        expect((e as CcxError).code).toBe(ErrorCode.PATTERN_DISCOVERY_FAILED)
      }
    })

    // B7: exceeds200k 阈值出现次数 ≠ 1 时抛错
    it('throws PATTERN_DISCOVERY_FAILED when exceeds200k threshold count is not 1', () => {
      const buffer = Buffer.from(
        'hdr;AP_=200000,YP_=20000;u6O=200000,m6O=1536;Z07=200000,Gh=50;xj3=200000,Ij_=3;OpK=200000,N9q=3;K)>200000:!1};K)>200000:!1};trl',
        'latin1',
      )

      expect(() => new PatternDiscovery().discover(buffer)).toThrow(CcxError)
    })

    // B9: 重叠锚点(2.1.178 式,MODEL 与 other 共享 ct=200000 物理段)各自产出唯一 search
    it('handles overlapping anchors (shared physical segment) producing distinct unique searches', () => {
      const buffer = Buffer.from(
        'hdr;_Z_=200000,ct=200000,qZ_=20000,gd5=32000;Pw3=200000,Ww3=1536;YS7=200000,Gk=50;gVO=200000,NOq=3;K)>200000:!1};trl',
        'latin1',
      )
      const text = buffer.toString('latin1')

      const searches = new PatternDiscovery().discover(buffer).map((p) => p.search)

      expect(searches).toHaveLength(6)
      // 两个重叠锚点各自贪婪,指向不同的 200000 字节
      expect(searches).toContain('_Z_=200000,ct=200000,qZ_=20000,gd5=32000')
      expect(searches).toContain('ct=200000,qZ_=20000,gd5=32000')
      // 重叠下每条仍唯一
      for (const s of searches) {
        expect(text.split(s).length - 1).toBe(1)
      }
    })
  })
})
