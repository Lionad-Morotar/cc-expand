import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { discoverSilenceGuardCandidates } from '../../src/core/silence-guard-discovery.js'
import { makeStandaloneGraph, makeMachO, wrapSectionData } from './helpers/binary-fixtures.js'
import { PatchEngine } from '../../src/core/patch-engine.js'

/**
 * guard 指令骨架：jnstricteq(0x52) lhs:arg2(0x07) rhs:const1(0x11) 跳转偏移(0x06)
 * + ret(0x6a) const2(0x12)，patch 把跳转偏移 06→04 使早退恒触发
 */
const SKELETON = Buffer.from([0x52, 0x07, 0x11, 0x06, 0x6a, 0x12])
const SIGNATURE = 'unrecognized-model-signal:'

/** 构造合成 binary：单模块 contents 含 signature，bytecode 由调用方给定 */
function makeBinary(bytecode: Buffer): Buffer {
  const { payload } = makeStandaloneGraph([
    { name: 'chunk-abc123.js', contents: `const s="${SIGNATURE}x"` , bytecode },
  ])
  return makeMachO(wrapSectionData(payload))
}

/** 骨架前后加噪声字节，噪声可在其他模块/其他位置重复以逼出上下文扩展 */
function seg(prefix: Buffer, suffix: Buffer): Buffer {
  return Buffer.concat([prefix, SKELETON, suffix])
}

const tokenGen = (slot: number) => '0'.repeat(slot)

describe('discoverSilenceGuardCandidates', () => {
  it('发现候选并产出可 patch 的唯一化锚（literal PatchItem 语义）', () => {
    // 骨架跨模块出现 2 次（共享前缀噪声，仅后缀末字节不同）→ 纯骨架不唯一，
    // 必须上下文扩展到差异字节才能唯一。decoy 在非 signature 模块，不产生候选
    const guardSeg = seg(Buffer.from([0x22, 0x85]), Buffer.from([0x1e, 0xf3, 0xfb, 0x99]))
    const decoySeg = seg(Buffer.from([0x22, 0x85]), Buffer.from([0x1e, 0xf3, 0xfb, 0xaa]))
    const { payload } = makeStandaloneGraph([
      { name: 'chunk-abc123.js', contents: `const s="${SIGNATURE}x"`, bytecode: guardSeg },
      { name: 'other.js', contents: 'other', bytecode: decoySeg },
    ])
    const binary = makeMachO(wrapSectionData(payload))

    const candidates = discoverSilenceGuardCandidates(binary)

    // 只统计 signature 模块内的候选（decoy 模块不产生候选）
    expect(candidates).toHaveLength(1)
    const c = candidates[0]
    // 锚含骨架序列且槽位（0x06）落在骨架内原位：相对骨架起点第 3 字节
    const skelIdx = c.search.indexOf(SKELETON.toString('latin1'))
    expect(skelIdx).toBeGreaterThanOrEqual(0)
    expect(c.search.indexOf(c.sourceValue)).toBe(skelIdx + 3)
    expect(c.sourceValue).toBe('\u0006')
    expect(c.target).toEqual({ value: '\u0004' })
    // 锚在全 binary 唯一（discovery 的核心契约）
    const anchorBuf = Buffer.from(c.search, 'latin1')
    expect(binary.indexOf(anchorBuf)).toBe(binary.lastIndexOf(anchorBuf))
    // 引擎级实证：literal patch 在副本上恰好命中一次
    const copy = Buffer.from(binary)
    const result = new PatchEngine().patch(copy, [c], tokenGen)
    expect(result.success).toBe(true)
    expect(result.replaceCount).toBe(1)
    expect(copy[c.offset]).toBe(0x04)
  })

  it('同模块多骨架产出多个候选，锚各自唯一化', () => {
    const g1 = seg(Buffer.from([0xaa]), Buffer.from([0x01]))
    const g2 = seg(Buffer.from([0xbb]), Buffer.from([0x02]))
    const binary = makeBinary(Buffer.concat([g1, Buffer.alloc(8), g2]))

    const candidates = discoverSilenceGuardCandidates(binary)

    expect(candidates).toHaveLength(2)
    // 候选按 blob 内偏移升序，锚各自唯一（两个锚互不相同即各自唯一化的证据）
    expect(candidates[0].offsetInModule).toBeLessThan(candidates[1].offsetInModule)
    expect(candidates[0].search).not.toBe(candidates[1].search)
    for (const c of candidates) {
      const anchorBuf = Buffer.from(c.search, 'latin1')
      expect(binary.indexOf(anchorBuf)).toBe(binary.lastIndexOf(anchorBuf))
    }
  })

  it('扩展引入的 0x06 早于骨架槽位时换扩展组合避开（槽位定位不被污染）', () => {
    // 前缀第一字节是 0x06：任何带前缀的扩展锚里 indexOf('\u0006') 都落在污染位置，
    // 扩展组合搜索须跳过前缀、改用纯后缀扩展达成唯一（差异字节在后缀末位）
    const guardSeg = seg(Buffer.from([0x06, 0x85]), Buffer.from([0x1e, 0xf3, 0xfb, 0x99]))
    const decoySeg = seg(Buffer.from([0x06, 0x85]), Buffer.from([0x1e, 0xf3, 0xfb, 0xaa]))
    const { payload } = makeStandaloneGraph([
      { name: 'chunk-abc123.js', contents: `const s="${SIGNATURE}x"`, bytecode: guardSeg },
      { name: 'other.js', contents: 'other', bytecode: decoySeg },
    ])
    const binary = makeMachO(wrapSectionData(payload))

    const candidates = discoverSilenceGuardCandidates(binary)

    expect(candidates).toHaveLength(1)
    const c = candidates[0]
    const slotIdx = c.search.indexOf(c.sourceValue)
    expect(slotIdx).toBe(c.search.lastIndexOf(c.sourceValue)) // 锚内恰好一次
    expect(c.search.charCodeAt(slotIdx - 1)).toBe(0x11) // 槽位前一字节是骨架的 const1
  })

  it('signature 未命中任何模块时 throw（fail loud）', () => {
    const { payload } = makeStandaloneGraph([
      { name: 'other.js', contents: 'no signal here', bytecode: SKELETON },
    ])
    const binary = makeMachO(wrapSectionData(payload))

    expect(() => discoverSilenceGuardCandidates(binary)).toThrow(/signature/)
  })

  it('signature 命中多个模块时 throw（无法确定目标）', () => {
    const { payload } = makeStandaloneGraph([
      { name: 'a.js', contents: SIGNATURE, bytecode: SKELETON },
      { name: 'b.js', contents: SIGNATURE, bytecode: SKELETON },
    ])
    const binary = makeMachO(wrapSectionData(payload))

    expect(() => discoverSilenceGuardCandidates(binary)).toThrow(/2 个模块/)
  })

  it('模块 bytecode 内无骨架时 throw（操作码漂移信号，触发人工重研究）', () => {
    const binary = makeBinary(Buffer.from([0x00, 0x01, 0x02, 0x03]))

    expect(() => discoverSilenceGuardCandidates(binary)).toThrow(/骨架/)
  })

  it('扩展至上限仍不唯一时 throw（fail loud，不产出存疑锚点）', () => {
    // 两份骨架段前后各有 24B 完全相同的噪声：16B 扩展上限内任何锚都在两处出现，
    // 且间隔超出可吞并范围（吞并对方需要 ≥24B 扩展），无法达成唯一
    const g = seg(Buffer.from([0x22]), Buffer.from([0x1e]))
    const noise = Buffer.alloc(24, 0x77)
    const binary = makeBinary(Buffer.concat([g, noise, g, noise]))

    expect(() => discoverSilenceGuardCandidates(binary)).toThrow(/唯一/)
  })
})
