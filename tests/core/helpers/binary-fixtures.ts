// 合成 fixture 构造器：按字段级格式手工构造最小 Mach-O / ELF / PE binary 与
// StandaloneModuleGraph payload，供解析层测试使用，不依赖真实 binary。
// 布局字段偏移对齐 Bun 源码 exe_format/*.rs 与 StandaloneModuleGraph.rs。

import { Buffer } from 'node:buffer'

/** StandaloneModuleGraph 尾部 trailer（16B） */
export const TRAILER = '\n---- Bun! ----\n'

export interface GraphFixtureModule {
  name?: Buffer | string
  contents?: Buffer | string
  bytecode?: Buffer | string
}

export interface GraphFixtureOptions {
  /** 默认 true → flags bit5，模块表后追加 N×4B 源 hash */
  sourceHashes?: boolean
  /** 提供则 flags bit6，模块表后追加 u32 count + count×12B（id + SP） */
  builtinBytecode?: Array<{ id: number; bytes: Buffer | string }>
  /** 提供则 flags bit7，追加 SP 指向共享 bytecode 字符串表 */
  bytecodeStringTable?: Buffer | string
  /** 默认 true → flags bit8，追加 u32 启动模块数 */
  startupModuleCount?: boolean
  /** 提供则 flags bit9，追加 SP 指向 module_info 字符串表 */
  moduleInfoStringTable?: Buffer | string
  entryPointId?: number
  compileExecArgv?: Buffer | string
}

function toBuf(v: Buffer | string | undefined): Buffer {
  return typeof v === 'string' ? Buffer.from(v, 'latin1') : v ?? Buffer.alloc(0)
}

function writeU64(buf: Buffer, off: number, v: number): void {
  buf.writeBigUInt64LE(BigInt(v), off)
}

function writeU32(buf: Buffer, off: number, v: number): void {
  buf.writeUInt32LE(v, off)
}

function writeU16(buf: Buffer, off: number, v: number): void {
  buf.writeUInt16LE(v, off)
}

function fillName(buf: Buffer, off: number, name: string, width: number): void {
  buf.write(name, off, 'latin1')
  buf.fill(0, off + name.length, off + width)
}

/**
 * 构造 StandaloneModuleGraph payload（不含 [u64 len] 头）：
 * [模块表 52×N][flags 链式记录][数据区][Offsets 32B][trailer 16B]
 * 模块表每条 6×SP(name/contents/sourcemap/bytecode/module_info/bytecode_origin_path) + 4×u8。
 * 数据区按模块顺序排列 name/contents/bytecode，SP 偏移相对 payload 起点。
 * 返回 { payload, spans }，spans 暴露各模块 SP 期望值便于测试断言。
 */
export function makeStandaloneGraph(
  modules: GraphFixtureModule[],
  options: GraphFixtureOptions = {},
): { payload: Buffer; spans: Array<Record<string, SpanFixture>> } {
  const count = modules.length
  const modTableLen = count * 52
  const builtin = options.builtinBytecode ?? []
  const stringTable = toBuf(options.bytecodeStringTable)
  const moduleInfoTable = toBuf(options.moduleInfoStringTable)
  const argv = toBuf(options.compileExecArgv)

  let flags = 0
  if (options.sourceHashes !== false) flags |= 1 << 5
  if (builtin.length > 0) flags |= 1 << 6
  if (stringTable.length > 0) flags |= 1 << 7
  if (options.startupModuleCount !== false) flags |= 1 << 8
  if (moduleInfoTable.length > 0) flags |= 1 << 9

  // 链式记录区（flags 位序），紧随模块表
  let recordsLen = modTableLen
  if (flags & (1 << 5)) recordsLen += count * 4
  if (flags & (1 << 6)) recordsLen += 4 + builtin.length * 12
  if (flags & (1 << 7)) recordsLen += 8
  if (flags & (1 << 8)) recordsLen += 4
  if (flags & (1 << 9)) recordsLen += 8

  // 数据区：逐模块 name/contents/bytecode，随后 builtin bytes / 字符串表 / argv
  const dataStart = recordsLen
  let cursor = dataStart
  const spans: Array<Record<string, SpanFixture>> = []
  for (let i = 0; i < count; i++) {
    const m = modules[i]
    const name = toBuf(m.name).length > 0 ? toBuf(m.name) : Buffer.from(`module_${i}.js`)
    const contents = toBuf(m.contents)
    const bytecode = toBuf(m.bytecode)
    const nameSp = { off: cursor, len: name.length }
    cursor += name.length
    const contentsSp = { off: cursor, len: contents.length }
    cursor += contents.length
    const bytecodeSp = { off: cursor, len: bytecode.length }
    cursor += bytecode.length
    spans.push({
      name: nameSp,
      contents: contentsSp,
      bytecode: bytecodeSp,
      sourcemap: { off: 0, len: 0 },
      moduleInfo: { off: 0, len: 0 },
      bytecodeOriginPath: { off: 0, len: 0 },
    })
  }
  const builtinSpans: Array<{ id: number; bytes: SpanFixture }> = []
  for (const b of builtin) {
    const bytes = toBuf(b.bytes)
    builtinSpans.push({ id: b.id, bytes: { off: cursor, len: bytes.length } })
    cursor += bytes.length
  }
  const stringTableSp = stringTable.length > 0 ? { off: cursor, len: stringTable.length } : null
  if (stringTableSp) cursor += stringTable.length
  const moduleInfoTableSp =
    moduleInfoTable.length > 0 ? { off: cursor, len: moduleInfoTable.length } : null
  if (moduleInfoTableSp) cursor += moduleInfoTable.length
  const argvSp = argv.length > 0 ? { off: cursor, len: argv.length } : null
  if (argvSp) cursor += argv.length

  const payloadLen = cursor + 32 + TRAILER.length
  const payload = Buffer.alloc(payloadLen)

  // 模块表
  for (let i = 0; i < count; i++) {
    const p = i * 52
    const sp = spans[i]
    writeU32(payload, p + 0, sp.name.off)
    writeU32(payload, p + 4, sp.name.len)
    writeU32(payload, p + 8, sp.contents.off)
    writeU32(payload, p + 12, sp.contents.len)
    writeU32(payload, p + 16, sp.sourcemap.off)
    writeU32(payload, p + 20, sp.sourcemap.len)
    writeU32(payload, p + 24, sp.bytecode.off)
    writeU32(payload, p + 28, sp.bytecode.len)
    writeU32(payload, p + 32, sp.moduleInfo.off)
    writeU32(payload, p + 36, sp.moduleInfo.len)
    writeU32(payload, p + 40, sp.bytecodeOriginPath.off)
    writeU32(payload, p + 44, sp.bytecodeOriginPath.len)
    payload[p + 48] = 0 // encoding
    payload[p + 49] = 1 // loader
    payload[p + 50] = 0 // module_format
    payload[p + 51] = 0 // side
  }

  // flags 链式记录（与 StandaloneModuleGraph::from_bytes 同序）
  let recAt = modTableLen
  if (flags & (1 << 5)) {
    for (let i = 0; i < count; i++) writeU32(payload, recAt + i * 4, i + 1)
    recAt += count * 4
  }
  if (flags & (1 << 6)) {
    writeU32(payload, recAt, builtin.length)
    recAt += 4
    for (const b of builtinSpans) {
      writeU32(payload, recAt, b.id)
      writeU32(payload, recAt + 4, b.bytes.off)
      writeU32(payload, recAt + 8, b.bytes.len)
      recAt += 12
    }
  }
  if (flags & (1 << 7)) {
    writeU32(payload, recAt, stringTableSp!.off)
    writeU32(payload, recAt + 4, stringTableSp!.len)
    recAt += 8
  }
  if (flags & (1 << 8)) {
    writeU32(payload, recAt, 1)
    recAt += 4
  }
  if (flags & (1 << 9)) {
    writeU32(payload, recAt, moduleInfoTableSp!.off)
    writeU32(payload, recAt + 4, moduleInfoTableSp!.len)
    recAt += 8
  }

  // 数据区
  for (let i = 0; i < count; i++) {
    const m = modules[i]
    const name = toBuf(m.name).length > 0 ? toBuf(m.name) : Buffer.from(`module_${i}.js`)
    const contents = toBuf(m.contents)
    const bytecode = toBuf(m.bytecode)
    const sp = spans[i]
    name.copy(payload, sp.name.off)
    contents.copy(payload, sp.contents.off)
    bytecode.copy(payload, sp.bytecode.off)
  }
  for (let i = 0; i < builtin.length; i++) {
    toBuf(builtin[i].bytes).copy(payload, builtinSpans[i].bytes.off)
  }
  if (stringTableSp) stringTable.copy(payload, stringTableSp.off)
  if (moduleInfoTableSp) moduleInfoTable.copy(payload, moduleInfoTableSp.off)
  if (argvSp) argv.copy(payload, argvSp.off)

  // Offsets（repr(C)：byte_count u64 | modules SP | entry u32 | argv SP | flags u32）
  const offAt = cursor
  writeU64(payload, offAt, payloadLen)
  writeU32(payload, offAt + 8, 0)
  writeU32(payload, offAt + 12, modTableLen)
  writeU32(payload, offAt + 16, options.entryPointId ?? 0)
  writeU32(payload, offAt + 20, argvSp?.off ?? 0)
  writeU32(payload, offAt + 24, argvSp?.len ?? 0)
  writeU32(payload, offAt + 28, flags)
  payload.write(TRAILER, offAt + 32, 'latin1')

  return { payload, spans }
}

export interface SpanFixture {
  off: number
  len: number
}

/** 给 section 内容加 [u64 len] 头 */
export function wrapSectionData(payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length)
  writeU64(out, 0, payload.length)
  payload.copy(out, 8)
  return out
}

/**
 * 构造最小 Mach-O 64-bit（arm64）binary：header 32B + 1 条 LC_SEGMENT_64(__BUN)
 * + 1 个 section_64(__bun) + sectionData。__bun 的 offset/size 指向 sectionData。
 */
export function makeMachO(sectionData: Buffer): Buffer {
  const dataOff = 32 + 72 + 80 // header + segment_command_64 + section_64
  const out = Buffer.alloc(dataOff + sectionData.length)
  writeU32(out, 0, 0xfeedfacf)
  writeU32(out, 4, 0x0100000c) // CPU_TYPE_ARM64
  writeU32(out, 8, 0)
  writeU32(out, 12, 2) // MH_EXECUTE
  writeU32(out, 16, 1) // ncmds
  writeU32(out, 20, 72 + 80) // sizeofcmds
  writeU32(out, 24, 0)
  writeU32(out, 28, 0)
  // LC_SEGMENT_64 @32
  writeU32(out, 32, 0x19)
  writeU32(out, 36, 72 + 80)
  fillName(out, 40, '__BUN', 16)
  writeU64(out, 56, 0) // vmaddr
  writeU64(out, 64, 0) // vmsize
  writeU64(out, 72, dataOff) // fileoff
  writeU64(out, 80, sectionData.length) // filesize
  writeU32(out, 88, 7) // maxprot
  writeU32(out, 92, 7) // initprot
  writeU32(out, 96, 1) // nsects
  writeU32(out, 100, 0)
  // section_64 @104
  fillName(out, 104, '__bun', 16)
  fillName(out, 120, '__BUN', 16)
  writeU64(out, 136, 0) // addr
  writeU64(out, 144, sectionData.length) // size（含 u64 头）
  writeU32(out, 152, dataOff) // offset（文件偏移）
  writeU32(out, 156, 12) // align
  writeU32(out, 160, 0) // reloff
  writeU32(out, 164, 0) // nreloc
  writeU32(out, 168, 0x80000400) // S_REGULAR | S_ATTR_NO_DEAD_STRIP
  writeU32(out, 172, 0)
  writeU32(out, 176, 0)
  writeU32(out, 180, 0)
  sectionData.copy(out, dataOff)
  return out
}

/**
 * 构造最小 ELF 64-bit LE binary：EHDR 64B + sectionData + .shstrtab + shdr 表。
 * shdr 表 3 条：空 / .shstrtab / .bun（sh_offset/sh_size 指向 sectionData）。
 */
export function makeELF(sectionData: Buffer): Buffer {
  // 标准 .shstrtab 以 NUL 开头（sh_name=0 的 shdr[0] 读到的必须是空串）
  const shstrtab = Buffer.from(' .bun .shstrtab ', 'latin1')
  const shdrTableOff = 64 + sectionData.length + shstrtab.length
  const out = Buffer.alloc(shdrTableOff + 3 * 64)
  // e_ident
  out[0] = 0x7f
  out.write('ELF', 1, 'latin1')
  out[4] = 2 // EI_CLASS 64-bit
  out[5] = 1 // EI_DATA LE
  out[6] = 1 // EI_VERSION
  writeU16(out, 0x10, 3) // e_type ET_DYN
  writeU16(out, 0x12, 0x3e) // e_machine x86-64
  writeU32(out, 0x14, 1)
  writeU64(out, 0x28, shdrTableOff) // e_shoff
  writeU16(out, 0x34, 64) // e_ehsize
  writeU16(out, 0x36, 0) // e_phentsize
  writeU16(out, 0x38, 0) // e_phnum
  writeU16(out, 0x3a, 64) // e_shentsize
  writeU16(out, 0x3c, 3) // e_shnum
  writeU16(out, 0x3e, 1) // e_shstrndx
  sectionData.copy(out, 64)
  shstrtab.copy(out, 64 + sectionData.length)
  const sh = shdrTableOff
  const writeShdr = (idx: number, name: number, type: number, offset: number, size: number) => {
    const p = sh + idx * 64
    writeU32(out, p, name)
    writeU32(out, p + 4, type)
    writeU64(out, p + 8, 0) // sh_flags
    writeU64(out, p + 16, 0) // sh_addr
    writeU64(out, p + 24, offset) // sh_offset
    writeU64(out, p + 32, size) // sh_size
    writeU32(out, p + 40, 0) // sh_link
    writeU32(out, p + 44, 0) // sh_info
    writeU64(out, p + 48, 1) // sh_addralign
    writeU64(out, p + 56, 0) // sh_entsize
  }
  // shdr[0] 全零；shdr[1] = .shstrtab（名称在 shstrtab 偏移 5，'.bun\0' 之后）
  writeShdr(0, 0, 0, 0, 0)
  writeShdr(1, 6, 3, 64 + sectionData.length, shstrtab.length)
  writeShdr(2, 1, 1, 64, sectionData.length) // .bun（名称在 shstrtab 偏移 1）
  return out
}

/**
 * 构造最小 PE32+ binary：DOS header 64B + 'PE\0\0' + COFF header 20B +
 * 1 条 section header(.bun) + sectionData。
 * VirtualAddress 随意（仅测运行时路径）；文件访问必须走 PointerToRawData。
 */
export function makePE(sectionData: Buffer): Buffer {
  const sigAt = 0x40
  const sectTableAt = sigAt + 24 // SizeOfOptionalHeader = 0
  const dataOff = sectTableAt + 40
  const out = Buffer.alloc(dataOff + sectionData.length)
  out.write('MZ', 0, 'latin1')
  writeU32(out, 0x3c, sigAt) // e_lfanew
  out.write('PE  ', sigAt, 'latin1')
  writeU16(out, sigAt + 4, 0x8664) // Machine x86-64
  writeU16(out, sigAt + 6, 1) // NumberOfSections
  writeU32(out, sigAt + 8, 0) // TimeDateStamp
  writeU32(out, sigAt + 12, 0) // PointerToSymbolTable
  writeU32(out, sigAt + 16, 0) // NumberOfSymbols
  writeU16(out, sigAt + 20, 0) // SizeOfOptionalHeader
  writeU16(out, sigAt + 22, 0x22) // Characteristics
  fillName(out, sectTableAt, '.bun', 8)
  writeU32(out, sectTableAt + 8, sectionData.length) // VirtualSize
  writeU32(out, sectTableAt + 12, 0x1000) // VirtualAddress（运行时内存路径）
  writeU32(out, sectTableAt + 16, sectionData.length) // SizeOfRawData
  writeU32(out, sectTableAt + 20, dataOff) // PointerToRawData
  writeU32(out, sectTableAt + 24, 0) // PointerToRelocations
  writeU32(out, sectTableAt + 28, 0) // PointerToLinenumbers
  writeU16(out, sectTableAt + 32, 0) // NumberOfRelocations
  writeU16(out, sectTableAt + 34, 0) // NumberOfLinenumbers
  writeU32(out, sectTableAt + 36, 0x40000040) // Characteristics
  sectionData.copy(out, dataOff)
  return out
}
