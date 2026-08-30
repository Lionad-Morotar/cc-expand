import { describe, it, expect } from 'vitest'
import {
  parseStandaloneGraph,
  readModuleContents,
  type BunSection,
} from '../../src/core/standalone-graph.js'
import { extractBunSection } from '../../src/core/binary-sections.js'
import {
  makeStandaloneGraph,
  makeMachO,
  makeELF,
  makePE,
  wrapSectionData,
  type SpanFixture,
} from './helpers/binary-fixtures.js'

/** 黄金序列：bytecode 常量池 u32 LE 四连 200000/32000/128000/1000000 */
const GOLDEN = Buffer.from([0x40, 0x0d, 0x03, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x00, 0xf4, 0x01, 0x00, 0x40, 0x42, 0x0f, 0x00])

const CONTENTS = 'export const vGe = 200000\n'

/** 把 payload 平铺在 makeMachO 的 payload 偏移处，构造「文件绝对偏移 = payloadStart + sp.off」的 buffer */
function binarySection(payload: Buffer): BunSection {
  return { payloadStart: 192, payloadLen: payload.length } // makeMachO: header 32 + segment 72 + section 80 + u64 头 8
}

function withSection(payload: Buffer): { buffer: Buffer; section: BunSection } {
  const section = binarySection(payload)
  const buffer = Buffer.concat([Buffer.alloc(section.payloadStart), payload])
  return { buffer, section }
}

/** 相对 payload 的 SP → 文件绝对偏移 */
function abs(section: BunSection, sp: SpanFixture): SpanFixture {
  return { off: section.payloadStart + sp.off, len: sp.len }
}

describe('parseStandaloneGraph', () => {
  describe('模块表解析', () => {
    it('parses a single module with name/contents/bytecode spans', () => {
      const { payload, spans } = makeStandaloneGraph([
        { name: 'entry.js', contents: CONTENTS, bytecode: GOLDEN },
      ])
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)

      expect(graph.modules).toHaveLength(1)
      const m = graph.modules[0]
      expect(m.name).toEqual(abs(section, spans[0].name))
      expect(m.contents).toEqual(abs(section, spans[0].contents))
      expect(m.bytecode).toEqual(abs(section, spans[0].bytecode))
      expect(m.sourcemap).toEqual(abs(section, { off: 0, len: 0 }))
      expect(m.moduleInfo).toEqual(abs(section, { off: 0, len: 0 }))
      expect(m.bytecodeOriginPath).toEqual(abs(section, { off: 0, len: 0 }))
      expect(m.encoding).toBe(0)
      expect(m.loader).toBe(1)
      expect(m.moduleFormat).toBe(0)
      expect(m.side).toBe(0)
      expect(graph.entryPointId).toBe(0)
      expect(graph.flags & (1 << 5)).toBeTruthy()
      expect(graph.byteCount).toBe(payload.length)
    })

    it('parses multiple modules with per-module spans and data', () => {
      const mods = [
        { name: 'a.js', contents: 'aaa', bytecode: Buffer.from([1, 2, 3]) },
        { name: 'b.js', contents: 'bbbb', bytecode: Buffer.from([4, 5]) },
        { name: 'c.js', contents: 'cc', bytecode: Buffer.alloc(0) },
      ]
      const { payload, spans } = makeStandaloneGraph(mods)
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)

      expect(graph.modules).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        const m = graph.modules[i]
        expect(m.name).toEqual(abs(section, spans[i].name))
        expect(m.contents).toEqual(abs(section, spans[i].contents))
        expect(m.bytecode).toEqual(abs(section, spans[i].bytecode))
      }
      // 区间互不重叠且都在 buffer 内
      for (const m of graph.modules) {
        for (const sp of [m.name, m.contents, m.bytecode]) {
          expect(sp.off + sp.len).toBeLessThanOrEqual(section.payloadStart + section.payloadLen)
        }
      }
    })

    it('exposes bytecode contents in file-absolute offsets', () => {
      const { payload, spans } = makeStandaloneGraph([{ bytecode: GOLDEN }])
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)

      const sp = graph.modules[0].bytecode
      expect(sp.off).toBe(abs(section, spans[0].bytecode).off)
      expect(buffer.subarray(sp.off, sp.off + sp.len)).toEqual(GOLDEN)
    })
  })

  describe('flags 链式记录', () => {
    it('parses all chained records when every flag bit is set', () => {
      const { payload } = makeStandaloneGraph(
        [{ contents: 'x' }, { contents: 'y' }],
        {
          builtinBytecode: [
            { id: 7, bytes: 'builtin-a' },
            { id: 8, bytes: 'builtin-b' },
          ],
          bytecodeStringTable: 'shared-strings',
          moduleInfoStringTable: 'info-strings',
          entryPointId: 1,
          compileExecArgv: '--no-lsp',
        },
      )
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)

      const flags = (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9)
      expect(graph.flags & flags).toBe(flags)
      // bit5 source_hashes：2 模块 × 4B
      expect(graph.sourceHashes?.len).toBe(8)
      // bit6 builtin_bytecode：count + {id, SP}×2
      expect(graph.builtinBytecode).toHaveLength(2)
      expect(graph.builtinBytecode![0].id).toBe(7)
      expect(graph.builtinBytecode![1].id).toBe(8)
      expect(
        buffer
          .subarray(graph.builtinBytecode![1].bytes.off, graph.builtinBytecode![1].bytes.off + graph.builtinBytecode![1].bytes.len)
          .toString('latin1'),
      ).toBe('builtin-b')
      // bit7 bytecode_string_table
      expect(graph.bytecodeStringTable?.len).toBe('shared-strings'.length)
      // bit8 startup_module_count
      expect(graph.startupModuleCount).toBe(1)
      // bit9 module_info_string_table
      expect(graph.moduleInfoStringTable?.len).toBe('info-strings'.length)
      // entry_point_id / compile_exec_argv
      expect(graph.entryPointId).toBe(1)
      expect(
        buffer.subarray(graph.compileExecArgv.off, graph.compileExecArgv.off + graph.compileExecArgv.len).toString('latin1'),
      ).toBe('--no-lsp')
    })

    it('omits records whose flag bits are clear', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }], {
        sourceHashes: false,
        startupModuleCount: false,
      })
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)

      expect(graph.flags & ((1 << 5) | (1 << 8))).toBe(0)
      expect(graph.sourceHashes).toBeUndefined()
      expect(graph.startupModuleCount).toBeUndefined()
      expect(graph.builtinBytecode).toBeUndefined()
      expect(graph.bytecodeStringTable).toBeUndefined()
      expect(graph.moduleInfoStringTable).toBeUndefined()
    })
  })

  describe('fail loud', () => {
    it('throws when the trailer does not match', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }])
      payload[payload.length - 1] = 0x58 // 破坏 trailer 末字节
      const { buffer, section } = withSection(payload)

      expect(() => parseStandaloneGraph(buffer, section)).toThrow(/trailer/i)
    })

    it('throws when a module span overruns the payload', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }])
      payload.writeUInt32LE(payload.length + 100, 12) // 模块表 contents.len 超出 payload
      const { buffer, section } = withSection(payload)

      expect(() => parseStandaloneGraph(buffer, section)).toThrow(/越界|bounds/i)
    })

    it('throws when a span is beyond the whole buffer', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }])
      payload.writeUInt32LE(1 << 30, 8) // 模块表 contents.off 指向文件外
      const { buffer, section } = withSection(payload)

      expect(() => parseStandaloneGraph(buffer, section)).toThrow(/越界|bounds/i)
    })

    it('throws when compile_exec_argv_ptr overruns the payload', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }], { compileExecArgv: '--x' })
      const offAt = payload.length - 32 - 16 // Offsets 起点 = payloadLen - Offsets - trailer
      payload.writeUInt32LE(payload.length + 100, offAt + 20) // compile_exec_argv_ptr.off 超出 payload
      const { buffer, section } = withSection(payload)

      expect(() => parseStandaloneGraph(buffer, section)).toThrow(/越界|bounds/i)
    })

    it('throws when the module table length is not a multiple of 52', () => {
      const { payload } = makeStandaloneGraph([{ contents: 'x' }])
      const offAt = payload.length - 32 - 16 // Offsets 起点 = payloadLen - Offsets - trailer
      payload.writeUInt32LE(53, offAt + 12) // modules_ptr.len
      const { buffer, section } = withSection(payload)

      expect(() => parseStandaloneGraph(buffer, section)).toThrow(/52|模块/i)
    })

    it('throws when the payload is too short for the trailer and offsets', () => {
      const section = { payloadStart: 0, payloadLen: 10 }
      expect(() => parseStandaloneGraph(Buffer.alloc(100), section)).toThrow(/trailer|payload/i)
    })
  })

  describe('readModuleContents', () => {
    it('decodes contents as latin1', () => {
      const utf8Bytes = Buffer.from('中文\n', 'utf8')
      const { payload, spans } = makeStandaloneGraph([{ contents: utf8Bytes }])
      const { buffer, section } = withSection(payload)

      const graph = parseStandaloneGraph(buffer, section)
      const text = readModuleContents(buffer, graph.modules[0])

      expect(text).toHaveLength(utf8Bytes.length)
      expect(text).toBe(utf8Bytes.toString('latin1'))
    })
  })

  describe('端到端：三格式 → 提取 → 解析 → 黄金序列', () => {
    it('locates the golden sequence inside the target module bytecode via Mach-O', () => {
      const { payload } = makeStandaloneGraph([
        { name: 'entry.js', contents: CONTENTS, bytecode: GOLDEN },
      ])
      const bin = makeMachO(wrapSectionData(payload))

      const graph = parseStandaloneGraph(bin, extractBunSection(bin))
      const sp = graph.modules[0].bytecode

      expect(bin.subarray(sp.off, sp.off + sp.len)).toEqual(GOLDEN)
    })

    it('round-trips through all three formats', () => {
      const { payload } = makeStandaloneGraph([
        { name: 'entry.js', contents: CONTENTS, bytecode: GOLDEN },
      ])
      const data = wrapSectionData(payload)

      for (const bin of [makeMachO(data), makeELF(data), makePE(data)]) {
        const graph = parseStandaloneGraph(bin, extractBunSection(bin))
        expect(graph.modules).toHaveLength(1)
        expect(graph.modules[0].bytecode.len).toBe(GOLDEN.length)
        expect(readModuleContents(bin, graph.modules[0])).toContain('vGe')
      }
    })
  })
})
