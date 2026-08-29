/**
 * StandaloneModuleGraph 模块表解析：输入 Bun payload 区间（来自 binary-sections 提取），
 * 解析出各模块的 name/contents/bytecode 等区间。所有 SP（StringPointer）偏移相对 payload
 * 起点，导出时换算为文件绝对偏移。解析失败一律 throw（fail loud）。
 * 布局参照 zRefs/bun/src/standalone_graph/StandaloneModuleGraph.rs 的 from_bytes。
 */
import { Buffer } from 'node:buffer'
import type { BunSection } from './binary-sections.js'

/** 模块表条目尺寸：6×SP(8B) + 4×u8(encoding/loader/module_format/side) */
const MODULE_RECORD_SIZE = 52
/** Offsets 结构尺寸（byte_count u64 | modules SP | entry u32 | argv SP | flags u32） */
const OFFSETS_SIZE = 32
/** payload 末尾 trailer */
const TRAILER = '\n---- Bun! ----\n'

/** 文件绝对区间 */
export interface Span {
  off: number
  len: number
}

export interface BunModule {
  index: number
  name: Span
  contents: Span
  sourcemap: Span
  bytecode: Span
  moduleInfo: Span
  bytecodeOriginPath: Span
  encoding: number
  loader: number
  moduleFormat: number
  side: number
}

export interface BuiltinBytecodeRecord {
  id: number
  bytes: Span
}

export interface StandaloneGraph {
  /** Offsets.byte_count：payload 总长（含 Offsets 与 trailer） */
  byteCount: number
  modules: BunModule[]
  entryPointId: number
  compileExecArgv: Span
  flags: number
  /** bit5：每模块 4B WTF 字符串 hash，紧随模块表 */
  sourceHashes?: Span
  /** bit6：内置模块预编译 bytecode 表（u32 count + count×12B） */
  builtinBytecode?: BuiltinBytecodeRecord[]
  /** bit7：共享 bytecode 字符串表 */
  bytecodeStringTable?: Span
  /** bit8：入口静态依赖闭包模块数 */
  startupModuleCount?: number
  /** bit9：module_info 共享字符串表 */
  moduleInfoStringTable?: Span
}

export interface Offsets {
  byteCount: number
  modulesPtr: Span
  entryPointId: number
  compileExecArgvPtr: Span
  flags: number
}

/** 从 payload 内读 Offsets 结构（位于 trailer 前 32B） */
export function readOffsets(buffer: Buffer, section: BunSection): Offsets {
  const { payloadStart, payloadLen } = section
  const trailerAt = payloadStart + payloadLen - TRAILER.length
  if (payloadLen < TRAILER.length + OFFSETS_SIZE || trailerAt < 0) {
    throw new Error('standalone graph: payload 过短，装不下 trailer 与 Offsets')
  }
  if (buffer.toString('latin1', trailerAt, trailerAt + TRAILER.length) !== TRAILER) {
    throw new Error('standalone graph: payload 末尾 trailer 不匹配')
  }
  const offAt = trailerAt - OFFSETS_SIZE
  return {
    byteCount: Number(buffer.readBigUInt64LE(offAt)),
    modulesPtr: { off: buffer.readUInt32LE(offAt + 8), len: buffer.readUInt32LE(offAt + 12) },
    entryPointId: buffer.readUInt32LE(offAt + 16),
    compileExecArgvPtr: { off: buffer.readUInt32LE(offAt + 20), len: buffer.readUInt32LE(offAt + 24) },
    flags: buffer.readUInt32LE(offAt + 28),
  }
}

/**
 * 校验相对 payload 的 SP 不越界（相对 payload 与绝对文件两个维度）。
 * u64 读出的偏移经 Number 转换：payload 远小于 2^53，无精度损失。
 */
function checkSpan(buffer: Buffer, section: BunSection, sp: Span, what: string): void {
  const { payloadStart, payloadLen } = section
  if (sp.off + sp.len > payloadLen) {
    throw new Error(`standalone graph: ${what} 区间越界（off=${sp.off} len=${sp.len} > payload ${payloadLen}）`)
  }
  if (payloadStart + sp.off + sp.len > buffer.length) {
    throw new Error(`standalone graph: ${what} 区间越界（off=${payloadStart + sp.off} len=${sp.len} > 文件 ${buffer.length}）`)
  }
}

/** 相对 payload 的 SP → 文件绝对偏移 */
function toAbs(section: BunSection, sp: Span): Span {
  return { off: section.payloadStart + sp.off, len: sp.len }
}

/** 解析 StandaloneModuleGraph，返回模块表与 flags 链式记录（SP 均为文件绝对偏移） */
export function parseStandaloneGraph(buffer: Buffer, section: BunSection): StandaloneGraph {
  const { payloadStart, payloadLen } = section
  if (payloadStart < 0 || payloadStart + payloadLen > buffer.length) {
    throw new Error('standalone graph: payload 区间越出文件')
  }
  const offsets = readOffsets(buffer, section)
  const { off: modOff, len: modLen } = offsets.modulesPtr
  checkSpan(buffer, section, offsets.modulesPtr, '模块表')
  if (modLen % MODULE_RECORD_SIZE !== 0) {
    throw new Error(`standalone graph: 模块表长度非 ${MODULE_RECORD_SIZE} 的倍数（${modLen}）`)
  }
  const count = modLen / MODULE_RECORD_SIZE
  const has = (bit: number): boolean => (offsets.flags >> bit & 1) === 1

  // flags 位序链式记录，紧随模块表（from_bytes 同序）
  const readU32 = (relOff: number): number => buffer.readUInt32LE(payloadStart + relOff)
  let recAt = modOff + modLen
  let sourceHashes: Span | undefined
  let builtinBytecode: BuiltinBytecodeRecord[] | undefined
  let bytecodeStringTable: Span | undefined
  let startupModuleCount: number | undefined
  let moduleInfoStringTable: Span | undefined

  if (has(5)) {
    const sp = { off: recAt, len: count * 4 }
    checkSpan(buffer, section, sp, 'source_hashes')
    sourceHashes = toAbs(section, sp)
    recAt += sp.len
  }
  if (has(6)) {
    if (recAt + 4 > payloadLen) throw new Error('standalone graph: builtin_bytecode count 越界')
    const n = readU32(recAt)
    recAt += 4
    const records: BuiltinBytecodeRecord[] = []
    for (let i = 0; i < n; i++) {
      if (recAt + 12 > payloadLen) throw new Error('standalone graph: builtin_bytecode 记录越界')
      const id = readU32(recAt)
      const sp = { off: readU32(recAt + 4), len: readU32(recAt + 8) }
      checkSpan(buffer, section, sp, `builtin_bytecode #${i}`)
      records.push({ id, bytes: toAbs(section, sp) })
      recAt += 12
    }
    builtinBytecode = records
  }
  if (has(7)) {
    if (recAt + 8 > payloadLen) throw new Error('standalone graph: bytecode_string_table SP 越界')
    const sp = { off: readU32(recAt), len: readU32(recAt + 4) }
    checkSpan(buffer, section, sp, 'bytecode_string_table')
    bytecodeStringTable = toAbs(section, sp)
    recAt += 8
  }
  if (has(8)) {
    if (recAt + 4 > payloadLen) throw new Error('standalone graph: startup_module_count 越界')
    startupModuleCount = readU32(recAt)
    recAt += 4
  }
  if (has(9)) {
    if (recAt + 8 > payloadLen) throw new Error('standalone graph: module_info_string_table SP 越界')
    const sp = { off: readU32(recAt), len: readU32(recAt + 4) }
    checkSpan(buffer, section, sp, 'module_info_string_table')
    moduleInfoStringTable = toAbs(section, sp)
    recAt += 8
  }

  // 模块表（52B/条：6×SP + 4×u8）
  const modules: BunModule[] = []
  for (let i = 0; i < count; i++) {
    const p = payloadStart + modOff + i * MODULE_RECORD_SIZE
    const sp = (o: number): Span => {
      const rel = { off: buffer.readUInt32LE(p + o), len: buffer.readUInt32LE(p + o + 4) }
      checkSpan(buffer, section, rel, `模块 #${i} SP@${o}`)
      return toAbs(section, rel)
    }
    modules.push({
      index: i,
      name: sp(0),
      contents: sp(8),
      sourcemap: sp(16),
      bytecode: sp(24),
      moduleInfo: sp(32),
      bytecodeOriginPath: sp(40),
      encoding: buffer[p + 48],
      loader: buffer[p + 49],
      moduleFormat: buffer[p + 50],
      side: buffer[p + 51],
    })
  }

  return {
    byteCount: offsets.byteCount,
    modules,
    entryPointId: offsets.entryPointId,
    compileExecArgv: toAbs(section, offsets.compileExecArgvPtr),
    flags: offsets.flags,
    sourceHashes,
    builtinBytecode,
    bytecodeStringTable,
    startupModuleCount,
    moduleInfoStringTable,
  }
}

/** latin1 解码模块 contents 区间（Bun 源码文本按 latin1 字节存储） */
export function readModuleContents(buffer: Buffer, module: BunModule): string {
  return buffer.subarray(module.contents.off, module.contents.off + module.contents.len).toString('latin1')
}
