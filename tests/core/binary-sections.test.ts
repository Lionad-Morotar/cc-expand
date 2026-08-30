import { describe, it, expect } from 'vitest'
import { extractBunSection } from '../../src/core/binary-sections.js'
import { makeMachO, makeELF, makePE, wrapSectionData } from './helpers/binary-fixtures.js'

/** 黄金序列：bytecode 常量池 u32 LE 四连 200000/32000/128000/1000000 */
const GOLDEN = Buffer.from([0x40, 0x0d, 0x03, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x00, 0xf4, 0x01, 0x00, 0x40, 0x42, 0x0f, 0x00])

const PAYLOAD = Buffer.concat([Buffer.from('hello standalone graph'), GOLDEN])

describe('extractBunSection', () => {
  describe('三格式正常提取', () => {
    // Mach-O: 最小 header + LC_SEGMENT_64(__BUN) + section_64(__bun)
    it('extracts __bun section from a minimal Mach-O binary', () => {
      const bin = makeMachO(wrapSectionData(PAYLOAD))

      const section = extractBunSection(bin)

      expect(section.payloadLen).toBe(PAYLOAD.length)
      expect(section.payloadStart).toBeGreaterThanOrEqual(0)
      expect(bin.subarray(section.payloadStart, section.payloadStart + section.payloadLen)).toEqual(PAYLOAD)
    })

    // ELF: EHDR + shstrtab + shdr 表，.bun 的 sh_offset/sh_size 指向数据
    it('extracts .bun section from a minimal ELF binary', () => {
      const bin = makeELF(wrapSectionData(PAYLOAD))

      const section = extractBunSection(bin)

      expect(section.payloadLen).toBe(PAYLOAD.length)
      expect(bin.subarray(section.payloadStart, section.payloadStart + section.payloadLen)).toEqual(PAYLOAD)
    })

    // PE: DOS header + 'PE\0\0' + COFF + section header(.bun)，文件数据在 PointerToRawData
    it('extracts .bun section from a minimal PE binary', () => {
      const bin = makePE(wrapSectionData(PAYLOAD))

      const section = extractBunSection(bin)

      expect(section.payloadLen).toBe(PAYLOAD.length)
      expect(bin.subarray(section.payloadStart, section.payloadStart + section.payloadLen)).toEqual(PAYLOAD)
    })

    it('extracts the same payload bytes from all three formats', () => {
      const data = wrapSectionData(PAYLOAD)
      const macho = makeMachO(data)
      const elf = makeELF(data)
      const pe = makePE(data)

      const fromMacho = extractBunSection(macho)
      const fromElf = extractBunSection(elf)
      const fromPe = extractBunSection(pe)

      const bytes = (bin: Buffer, s: { payloadStart: number; payloadLen: number }) =>
        bin.subarray(s.payloadStart, s.payloadStart + s.payloadLen)
      expect(bytes(macho, fromMacho)).toEqual(bytes(elf, fromElf))
      expect(bytes(elf, fromElf)).toEqual(bytes(pe, fromPe))
    })

    it('round-trips the golden bytecode sequence embedded in the payload', () => {
      const bin = makeMachO(wrapSectionData(PAYLOAD))

      const { payloadStart, payloadLen } = extractBunSection(bin)
      const extracted = bin.subarray(payloadStart, payloadStart + payloadLen)

      expect(extracted.includes(GOLDEN)).toBe(true)
    })
  })

  describe('fail loud', () => {
    it('throws for an unrecognized magic', () => {
      expect(() => extractBunSection(Buffer.from('not a binary at all'))).toThrow(/格式|format/i)
      expect(() => extractBunSection(Buffer.alloc(0))).toThrow(/格式|format/i)
    })

    it('throws for a Mach-O without the __BUN segment', () => {
      const bin = makeMachO(wrapSectionData(PAYLOAD))
      // 把 segment 的 segname 改成 __XXX，__bun 随之不可达
      bin.write('__XXX', 40, 'latin1')
      expect(() => extractBunSection(bin)).toThrow(/Mach-O/)
    })

    it('throws for an ELF without the .bun section', () => {
      const bin = makeELF(wrapSectionData(PAYLOAD))
      // 改 .bun shdr 的 sh_name 指向 '.shstrtab'（偏移 5）
      bin.writeUInt32LE(5, bin.readUInt32LE(0x28) + 2 * 64)
      expect(() => extractBunSection(bin)).toThrow(/ELF/)
    })

    it('throws for a PE without the .bun section', () => {
      const bin = makePE(wrapSectionData(PAYLOAD))
      bin.write('DATA', 0x58, 'latin1') // section Name 8B 改掉
      expect(() => extractBunSection(bin)).toThrow(/PE/)
    })

    it('throws when the u64 length disagrees with the section size (Mach-O)', () => {
      const bin = makeMachO(wrapSectionData(PAYLOAD))
      bin.writeBigUInt64LE(BigInt(PAYLOAD.length + 1), 144) // section.size 增大 1
      expect(() => extractBunSection(bin)).toThrow(/Mach-O/)
    })

    it('throws when the u64 length disagrees with the section size (ELF)', () => {
      const bin = makeELF(wrapSectionData(PAYLOAD))
      const shdr = bin.readUInt32LE(0x28) + 2 * 64
      bin.writeBigUInt64LE(BigInt(PAYLOAD.length + 1), shdr + 32) // sh_size 增大 1
      expect(() => extractBunSection(bin)).toThrow(/ELF/)
    })

    it('throws when the u64 length overruns the file', () => {
      const bin = makePE(wrapSectionData(PAYLOAD))
      // SizeOfRawData 声明超长，但文件没有那么多字节
      bin.writeUInt32LE(PAYLOAD.length + 4096, 0x68)
      expect(() => extractBunSection(bin)).toThrow(/PE/)
    })

    it('throws when the u64 length header itself is out of file bounds', () => {
      const bin = makeMachO(wrapSectionData(PAYLOAD))
      bin.writeUInt32LE(999999, 152) // section offset 指向文件外
      expect(() => extractBunSection(bin)).toThrow(/Mach-O/)
    })
  })

  describe('PE 文件偏移语义（关键坑）', () => {
    it('resolves file data via PointerToRawData, not VirtualAddress', () => {
      const bin = makePE(wrapSectionData(PAYLOAD))
      // 篡改 VirtualAddress（运行时内存路径）不影响文件解析
      bin.writeUInt32LE(0x9999, 0x64)

      const section = extractBunSection(bin)

      expect(section.payloadStart).toBe(0x88) // 0x58(section header) + 40 + 8(u64 头)
      expect(section.payloadLen).toBe(PAYLOAD.length)
    })
  })
})
