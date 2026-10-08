import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { discoverBytecodeAnchor } from '../../src/core/bytecode-anchor-discovery.js'
import { makeMachO, makeStandaloneGraph, wrapSectionData } from './helpers/binary-fixtures.js'

/** 黄金锚点（2.1.250 darwin/arm64 手工实证）：常量池四连 Int32 LE 200000/32000/128000/1000000，
 *  首槽为 context-window 常量（vGe/UN），{{tokens}} 占位替换它 */
const GOLDEN_ANCHOR = '{{tokens}}007d000000f4010040420f00'
const SOURCE_TOKENS = 200000
const SIGNATURE = 'MARKER=200000'

/** 黄金测试 binary：默认本机缓存的 2.1.250，CCX_ANCHOR_TEST_BINARY 可覆盖 */
const binaryPath = process.env.CCX_ANCHOR_TEST_BINARY ?? join(homedir(), '.cc-expand/packages/2.1.250/bin/claude')
const binaryExists = existsSync(binaryPath)

/** 黄金序列（u32 LE 四连）：sourceTokens/32000/128000/尾值 */
const goldenSequence = (last: number): Buffer => {
  const buf = Buffer.alloc(16)
  buf.writeUInt32LE(SOURCE_TOKENS, 0)
  buf.writeUInt32LE(32000, 4)
  buf.writeUInt32LE(128000, 8)
  buf.writeUInt32LE(last, 12)
  return buf
}

/** 构造任意 u32 LE 序列（bytecode 常量池片段） */
const seq = (...nums: number[]): Buffer => {
  const buf = Buffer.alloc(nums.length * 4)
  nums.forEach((v, i) => buf.writeUInt32LE(v, i * 4))
  return buf
}

/** 构造 fixture binary：目标模块（contents 含 signature，bytecode 为黄金序列真身）+
 *  反例模块（相同前缀序列、不同尾值，迫使锚点扩展伴生才能在全 binary 中唯一）。
 *  duplicate 时目标模块 bytecode 为对称两份真身（前后填充相同），扩展永远不唯一。 */
const makeFixture = (duplicate = false): Buffer => {
  const targetBytecode = duplicate
    ? Buffer.concat([
        Buffer.alloc(32, 0xee),
        goldenSequence(1000000),
        Buffer.alloc(32, 0xee),
        goldenSequence(1000000),
        Buffer.alloc(32, 0xee),
      ])
    : goldenSequence(1000000)
  const graph = makeStandaloneGraph([
    { name: 'target.js', contents: `// ${SIGNATURE}`, bytecode: targetBytecode },
    { name: 'decoy.js', contents: '// decoy', bytecode: goldenSequence(12345) },
  ])
  return makeMachO(wrapSectionData(graph.payload))
}

describe('discoverBytecodeAnchor', () => {
  it('should emit the golden anchor from the fixture end to end (tracer bullet)', () => {
    const result = discoverBytecodeAnchor(makeFixture(), SIGNATURE, SOURCE_TOKENS)

    expect(result).toEqual([GOLDEN_ANCHOR])
  })

  describe('fail loud', () => {
    it('should throw when the signature matches no module', () => {
      expect(() => discoverBytecodeAnchor(makeFixture(), 'NO_SUCH_MARKER', SOURCE_TOKENS)).toThrow(/未命中任何模块/)
    })

    it('should throw when the signature matches multiple modules', () => {
      const graph = makeStandaloneGraph([
        { name: 'a.js', contents: `// ${SIGNATURE}`, bytecode: goldenSequence(1000000) },
        { name: 'b.js', contents: `// ${SIGNATURE}`, bytecode: goldenSequence(12345) },
      ])
      const buffer = makeMachO(wrapSectionData(graph.payload))
      expect(() => discoverBytecodeAnchor(buffer, SIGNATURE, SOURCE_TOKENS)).toThrow(/命中 \d+ 个模块/)
    })

    it('should throw when the target module bytecode has no sourceTokens slot', () => {
      const graph = makeStandaloneGraph([
        { name: 'target.js', contents: `// ${SIGNATURE}`, bytecode: Buffer.alloc(16, 0xab) },
      ])
      const buffer = makeMachO(wrapSectionData(graph.payload))
      expect(() => discoverBytecodeAnchor(buffer, SIGNATURE, SOURCE_TOKENS)).toThrow(/无 \d+ 槽位/)
    })

    it('should throw when the target module bytecode span is empty', () => {
      const graph = makeStandaloneGraph([
        { name: 'target.js', contents: `// ${SIGNATURE}`, bytecode: Buffer.alloc(0) },
      ])
      const buffer = makeMachO(wrapSectionData(graph.payload))
      expect(() => discoverBytecodeAnchor(buffer, SIGNATURE, SOURCE_TOKENS)).toThrow(/区间为空/)
    })

    it('should throw when two slots each extend to a distinct unique pattern (ambiguous)', () => {
      // 两个槽位伴生链不同且各自全 binary 唯一：n=0 纯槽位出现 2 次，
      // n=1 起 [200000][111] 与 [200000][444] 各恰 1 次 → 合格候选 2 个，歧义必须 fail loud
      const graph = makeStandaloneGraph([
        {
          name: 'target.js',
          contents: `// ${SIGNATURE}`,
          bytecode: Buffer.concat([seq(SOURCE_TOKENS, 111, 222, 333), seq(SOURCE_TOKENS, 444, 555, 666)]),
        },
        { name: 'decoy.js', contents: '// decoy', bytecode: Buffer.alloc(16, 0xaa) },
      ])
      const buffer = makeMachO(wrapSectionData(graph.payload))
      expect(() => discoverBytecodeAnchor(buffer, SIGNATURE, SOURCE_TOKENS)).toThrow(/合格候选 2 个/)
    })

    it('should throw when the golden sequence appears twice (never unique)', () => {
      expect(() => discoverBytecodeAnchor(makeFixture(true), SIGNATURE, SOURCE_TOKENS)).toThrow(/合格候选/)
    })
  })
})

describe('discoverBytecodeAnchor · 语义伴生裁决（多候选）', () => {
  const TIEBREAK_SIGNATURE = 'MARKER=200000,OUT=32000,CTX=128000'

  it('should pick the candidate whose leading companion matches the signature companion', () => {
    // 复刻 linux-x64 2.1.291 布局漂移：模块内 2 个 200000 槽各自扩展均已唯一，
    // 语义主项（首伴生 32000）与漂移噪声槽（首伴生 703466）靠语义伴生判别
    const graph = makeStandaloneGraph([
      {
        name: 'target.js',
        contents: `// ${TIEBREAK_SIGNATURE}`,
        bytecode: Buffer.concat([seq(SOURCE_TOKENS, 32000, 211), seq(SOURCE_TOKENS, 703466, 212)]),
      },
      { name: 'decoy.js', contents: '// decoy', bytecode: Buffer.alloc(16, 0xaa) },
    ])
    const buffer = makeMachO(wrapSectionData(graph.payload))

    expect(discoverBytecodeAnchor(buffer, TIEBREAK_SIGNATURE, SOURCE_TOKENS)).toEqual(['{{tokens}}007d0000'])
  })

  it('should fail loud when no candidate leading companion matches the signature companion', () => {
    const graph = makeStandaloneGraph([
      {
        name: 'target.js',
        contents: `// ${TIEBREAK_SIGNATURE}`,
        bytecode: Buffer.concat([seq(SOURCE_TOKENS, 111, 222, 333), seq(SOURCE_TOKENS, 444, 555, 666)]),
      },
      { name: 'decoy.js', contents: '// decoy', bytecode: Buffer.alloc(16, 0xaa) },
    ])
    const buffer = makeMachO(wrapSectionData(graph.payload))

    expect(() => discoverBytecodeAnchor(buffer, TIEBREAK_SIGNATURE, SOURCE_TOKENS)).toThrow(
      /首伴生 == 0x007d0000 者 0 个/,
    )
  })
})

describe.skipIf(!binaryExists)('golden test (real binary)', () => {
  it('should rediscover a unique anchor of CC 2.1.250 darwin/arm64 (shortest, not the manual 3-companion)', () => {
    const buffer = readFileSync(binaryPath)
    const result = discoverBytecodeAnchor(buffer, 'vGe=200000', SOURCE_TOKENS)

    // 算法求最短唯一锚点：全 binary 计数 [200000] 23 处、[200000][32000] 2 处
    // （另一处在别的模块，后随 64000）、[200000][32000][128000] 1 处 → 2 伴生即唯一。
    // 手工实证的 3 伴生四连（docs/research/2026-08-28-bun-bytecode-patch.md 只验证了
    // 四连唯一后直接采用）是充分值而非最短值，两形态等价有效。
    expect(result).toEqual(['{{tokens}}007d000000f40100'])
  })
}, 30_000)

/** 语义伴生裁决黄金测试用的真实二进制：linux-x64 2.1.291（唯一性失效的双 200000 槽）。
 *  CCX_ANCHOR_TIEBREAK_BINARY 覆盖；默认取本机 extracted 缓存，不存在则跳过。 */
const tiebreakBinaryPath =
  process.env.CCX_ANCHOR_TIEBREAK_BINARY ??
  join(process.cwd(), 'zRefs/claude-codes/extracted/v2.1.291/linux-x64/package/claude')
const tiebreakBinaryExists = existsSync(tiebreakBinaryPath)

describe.skipIf(!tiebreakBinaryExists)('golden test · 语义伴生裁决 (real linux-x64 2.1.291)', () => {
  it('should resolve the duplicate 200000 slot to the semantic main item via the companion', () => {
    const buffer = readFileSync(tiebreakBinaryPath)
    const result = discoverBytecodeAnchor(buffer, 'o2e=200000,D6=200000,cv=32000,YI=128000', SOURCE_TOKENS)

    // 目标模块内 2 个 200000 槽各自扩展均可全 binary 唯一（rel 92484 与 182288），
    // 唯一性无法区分；仅 rel 92484 的首伴生槽为 32000（语义主项），182288 落在浮点噪声区
    expect(result).toEqual(['{{tokens}}007d0000f6570300'])
  })
}, 30_000)
