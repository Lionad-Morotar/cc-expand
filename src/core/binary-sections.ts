/**
 * 从 Bun standalone 编译的 Claude Code 可执行文件中定位内嵌 StandaloneModuleGraph payload。
 * 三格式（Mach-O / ELF / PE）的 section 内容布局均为 [u64 payload_len][payload]，
 * 本模块按魔数分派解析 section 表，返回跳过 8 字节长度头的 payload 文件区间。
 * 任何解析失败一律 throw（fail loud），不返回 null / 默认值。
 */
import { Buffer } from 'node:buffer'

export interface BunSection {
  /** payload 文件绝对偏移（section 起点 + 8，即跳过 u64 长度头） */
  payloadStart: number
  /** payload 长度（u64 头声明的值） */
  payloadLen: number
}

const MACHO_HEADER_SIZE = 32
const SEGMENT_CMD_SIZE = 72
const SECTION_64_SIZE = 80
const ELF_EHDR_SIZE = 64
const ELF_SHDR_SIZE = 64
const PE_SECTION_SIZE = 40

const LC_SEGMENT_64 = 0x19
const SEGNAME_BUN = '__BUN'
const SECTNAME_BUN = '__bun'
const ELF_SECTION_NAME = '.bun'
const PE_SECTION_NAME = '.bun\0\0\0\0'

const MAGIC_MACHO_64 = 0xfeedfacf

/** u64 长度头与 Mach-O/ELF section 尺寸的差值：内容为 [u64 len][payload]，len === size - 8 */
const LENGTH_HEADER_SIZE = 8

/**
 * 按魔数分派三格式解析，返回 Bun payload 文件区间。
 *
 * @throws Error 魔数不认识 / section 不存在 / 区间越界 / 长度声明不一致
 */
export function extractBunSection(buffer: Buffer): BunSection {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === MAGIC_MACHO_64) {
    return extractMachO(buffer)
  }
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return extractElf(buffer)
  }
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return extractPe(buffer)
  }
  throw new Error(`无法识别的二进制格式（magic: ${buffer.subarray(0, 4).toString('hex')}）`)
}

/**
 * 读取 section 内的 u64 长度头并校验：
 * - u64 声明长度必须与 section 剩余尺寸一致（PE 的 SizeOfRawData 按 file_alignment 对齐，
 *   含尾部零填充，故 PE 只要求声明长度不超出）
 * - payload 区间必须落在文件内
 * payloadLen 经 u64 转换：可执行文件 payload 远小于 2^53，Number 转换无精度损失。
 */
function readSectionPayload(
  buffer: Buffer,
  fmt: string,
  sectionOff: number,
  sectionSize: number,
  exactSize: boolean,
): BunSection {
  if (sectionOff + LENGTH_HEADER_SIZE > buffer.length) {
    throw new Error(`${fmt}: section 起点越界（offset=${sectionOff}）`)
  }
  if (sectionOff + sectionSize > buffer.length) {
    throw new Error(`${fmt}: section 区间越界（[${sectionOff}, ${sectionOff + sectionSize}) 超出文件 ${buffer.length}）`)
  }
  const payloadLen = Number(buffer.readBigUInt64LE(sectionOff))
  if (exactSize && payloadLen + LENGTH_HEADER_SIZE !== sectionSize) {
    throw new Error(`${fmt}: u64 长度头与 section 尺寸不一致（len=${payloadLen}, section=${sectionSize}）`)
  }
  if (!exactSize && payloadLen + LENGTH_HEADER_SIZE > sectionSize) {
    throw new Error(`${fmt}: u64 长度头超出 section 尺寸（len=${payloadLen}, section=${sectionSize}）`)
  }
  const payloadStart = sectionOff + LENGTH_HEADER_SIZE
  if (payloadStart + payloadLen > buffer.length) {
    throw new Error(`${fmt}: payload 区间越界（[${payloadStart}, ${payloadStart + payloadLen}) 超出文件 ${buffer.length}）`)
  }
  return { payloadStart, payloadLen }
}

/** 从 16B 定长名字域中截取 NUL 结尾部分 */
function readName(bytes: Buffer, off: number, width: number): string {
  const nul = bytes.indexOf(0, off)
  const end = nul === -1 ? off + width : nul
  return bytes.subarray(off, end).toString('latin1')
}

/**
 * Mach-O 64-bit：header 32B 后遍历 ncmds 条 load_command（cmd u32 + cmdsize u32），
 * 命中 LC_SEGMENT_64 且 segname == '__BUN' 时查其 section_64 表找 '__bun'。
 * __bun 的 offset（文件偏移）与 size 直接来自 section 头，不用 segment 的 fileoff。
 */
function extractMachO(buffer: Buffer): BunSection {
  const fmt = 'Mach-O'
  if (buffer.length < MACHO_HEADER_SIZE) throw new Error(`${fmt}: 文件小于 32B header`)
  const ncmds = buffer.readUInt32LE(16)
  const sizeofcmds = buffer.readUInt32LE(20)
  if (MACHO_HEADER_SIZE + sizeofcmds > buffer.length) {
    throw new Error(`${fmt}: load command 区越界（sizeofcmds=${sizeofcmds}）`)
  }
  let off = MACHO_HEADER_SIZE
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > buffer.length) throw new Error(`${fmt}: load command 越界`)
    const cmd = buffer.readUInt32LE(off)
    const cmdsize = buffer.readUInt32LE(off + 4)
    if (cmdsize < 8 || off + cmdsize > MACHO_HEADER_SIZE + sizeofcmds) {
      throw new Error(`${fmt}: load command 大小非法（cmdsize=${cmdsize}）`)
    }
    if (cmd === LC_SEGMENT_64 && cmdsize >= SEGMENT_CMD_SIZE) {
      if (readName(buffer, off + 8, 16) === SEGNAME_BUN) {
        const nsects = buffer.readUInt32LE(off + 64)
        const sectionsBase = off + SEGMENT_CMD_SIZE
        // section 表必须落在该 load command 的 cmdsize 范围内（nsects 不可信）
        if (sectionsBase + nsects * SECTION_64_SIZE > off + cmdsize) {
          throw new Error(`${fmt}: __BUN 的 section 表超出 load command 范围`)
        }
        for (let s = 0; s < nsects; s++) {
          const sect = sectionsBase + s * SECTION_64_SIZE
          if (readName(buffer, sect, 16) !== SECTNAME_BUN) continue
          const size = Number(buffer.readBigUInt64LE(sect + 40))
          const fileoff = buffer.readUInt32LE(sect + 48)
          return readSectionPayload(buffer, fmt, fileoff, size, true)
        }
      }
    }
    off += cmdsize
  }
  throw new Error(`${fmt}: 未找到 __BUN segment 内的 __bun section`)
}

/**
 * ELF 64-bit LE：e_shoff 定位 section header 表，第 e_shstrndx 条 shdr 的 sh_offset 定位
 * .shstrtab，遍历全部 shdr 按 sh_name 索引字符串表找 '.bun'。
 */
function extractElf(buffer: Buffer): BunSection {
  const fmt = 'ELF'
  if (buffer.length < ELF_EHDR_SIZE) throw new Error(`${fmt}: 文件小于 64B EHDR`)
  if (buffer[4] !== 2) throw new Error(`${fmt}: 仅支持 64-bit（EI_CLASS=${buffer[4]}）`)
  if (buffer[5] !== 1) throw new Error(`${fmt}: 仅支持小端（EI_DATA=${buffer[5]}）`)
  const shoff = Number(buffer.readBigUInt64LE(0x28))
  const shentsize = buffer.readUInt16LE(0x3a)
  const shnum = buffer.readUInt16LE(0x3c)
  const shstrndx = buffer.readUInt16LE(0x3e)
  if (shentsize < ELF_SHDR_SIZE) throw new Error(`${fmt}: e_shentsize 小于 64（${shentsize}）`)
  if (shnum === 0) throw new Error(`${fmt}: 无 section 表（e_shnum=0）`)
  if (shoff + shnum * ELF_SHDR_SIZE > buffer.length) throw new Error(`${fmt}: section 表越界`)
  if (shstrndx >= shnum) throw new Error(`${fmt}: e_shstrndx 越界（${shstrndx} >= ${shnum}）`)
  const strtabShdr = shoff + shstrndx * ELF_SHDR_SIZE
  const strtabOff = Number(buffer.readBigUInt64LE(strtabShdr + 24))
  const strtabSize = Number(buffer.readBigUInt64LE(strtabShdr + 32))
  if (strtabOff + strtabSize > buffer.length) throw new Error(`${fmt}: .shstrtab 越界`)
  for (let i = 0; i < shnum; i++) {
    const sh = shoff + i * ELF_SHDR_SIZE
    const shName = buffer.readUInt32LE(sh)
    if (shName >= strtabSize) throw new Error(`${fmt}: section #${i} 的 sh_name 超出 .shstrtab`)
    const nameStart = strtabOff + shName
    const nul = buffer.indexOf(0, nameStart)
    if (nul === -1 || nul >= strtabOff + strtabSize) throw new Error(`${fmt}: section #${i} 名称未以 NUL 结尾`)
    if (buffer.subarray(nameStart, nul).toString('latin1') !== ELF_SECTION_NAME) continue
    const shOffset = Number(buffer.readBigUInt64LE(sh + 24))
    const shSize = Number(buffer.readBigUInt64LE(sh + 32))
    return readSectionPayload(buffer, fmt, shOffset, shSize, true)
  }
  throw new Error(`${fmt}: 未找到 .bun section`)
}

/**
 * PE：'MZ' 头 → e_lfanew 指向 'PE\0\0' → COFF header → section 表。
 * 文件数据必须用 PointerToRawData/SizeOfRawData；VirtualAddress 是运行时内存路径，
 * 其文件偏移对不上（RVA 需经 section 表换算），禁止用于定位。
 */
function extractPe(buffer: Buffer): BunSection {
  const fmt = 'PE'
  if (buffer.length < 0x40) throw new Error(`${fmt}: 文件小于 64B DOS header`)
  const eLfanew = buffer.readUInt32LE(0x3c)
  if (eLfanew + 4 > buffer.length) throw new Error(`${fmt}: e_lfanew 越界`)
  if (buffer.toString('latin1', eLfanew, eLfanew + 4) !== 'PE\0\0') {
    throw new Error(`${fmt}: PE signature 缺失（e_lfanew=${eLfanew}）`)
  }
  const numSections = buffer.readUInt16LE(eLfanew + 6)
  const optSize = buffer.readUInt16LE(eLfanew + 20)
  const sectTable = eLfanew + 24 + optSize
  for (let i = 0; i < numSections; i++) {
    const s = sectTable + i * PE_SECTION_SIZE
    if (s + PE_SECTION_SIZE > buffer.length) throw new Error(`${fmt}: section 表越界`)
    if (buffer.toString('latin1', s, s + 8) !== PE_SECTION_NAME) continue
    const rawSize = buffer.readUInt32LE(s + 16)
    const rawPtr = buffer.readUInt32LE(s + 20)
    // SizeOfRawData 按 file_alignment 对齐（含尾部零填充），长度声明只需不超出
    return readSectionPayload(buffer, fmt, rawPtr, rawSize, false)
  }
  throw new Error(`${fmt}: 未找到 .bun section`)
}
