/**
 * banner 守卫纯函数测试
 * guard-banner.js 兼作 dist/cli.js 的注入 banner 与可导入模块，这里只测纯函数面
 * （顶层守卫在达标 node 上直接 return，导入无副作用）
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = require('../../src/cli/guard-banner.js') as {
  supportsRequireEsm: (version: string) => boolean
  candidateNodePaths: (env?: Record<string, string | undefined>) => string[]
}

describe('supportsRequireEsm', () => {
  it('v22+ 与 v24 全系可用', () => {
    expect(guard.supportsRequireEsm('v22.0.0')).toBe(true)
    expect(guard.supportsRequireEsm('v22.22.1')).toBe(true)
    expect(guard.supportsRequireEsm('v24.15.0')).toBe(true)
  })

  it('v20.19+ backport 可用，20.18 及以下不可用', () => {
    expect(guard.supportsRequireEsm('v20.19.0')).toBe(true)
    expect(guard.supportsRequireEsm('v20.19.5')).toBe(true)
    expect(guard.supportsRequireEsm('v20.18.1')).toBe(false)
    expect(guard.supportsRequireEsm('v20.11.1')).toBe(false)
  })

  it('v16/v18/v19 等老版本不可用', () => {
    expect(guard.supportsRequireEsm('v16.20.2')).toBe(false)
    expect(guard.supportsRequireEsm('v18.15.0')).toBe(false)
    expect(guard.supportsRequireEsm('v19.8.1')).toBe(false)
  })

  it('非版本串判不可用', () => {
    expect(guard.supportsRequireEsm('')).toBe(false)
    expect(guard.supportsRequireEsm('node')).toBe(false)
  })
})

describe('candidateNodePaths', () => {
  it('CC_EXPAND_NODE 优先入列', () => {
    const list = guard.candidateNodePaths({ CC_EXPAND_NODE: '/opt/fake/node' })
    expect(list[0]).toBe('/opt/fake/node')
  })

  it('常见默认安装位按序入列（存在性由消费方筛）', () => {
    const list = guard.candidateNodePaths({})
    expect(list.length).toBe(5)
    // fnm mac 别名位与 homebrew 位必须在候选序里
    expect(list.some((p) => p.includes('fnm/aliases/default'))).toBe(true)
    expect(list).toContain('/opt/homebrew/bin/node')
  })

  it('空 env 不炸', () => {
    expect(() => guard.candidateNodePaths({})).not.toThrow()
  })
})
