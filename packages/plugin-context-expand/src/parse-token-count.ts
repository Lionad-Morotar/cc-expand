/**
 * 解析用户输入的 token 数量
 * 支持：纯数字、千分位逗号、k/K（千）、w/W（万）、m/M（百万）后缀
 *
 * 为什么支持 m：formatTokenCount 用求余链 M→w→k 生成 shortVer（如 1000000→"1m"），
 * parse 必须能反解，否则 parse(format(n))!==n 双向对称破裂（ADR 0003 决策 8）。
 */
import { CcxError, ErrorCode } from './ccx-error.js'

export function parseTokenCount(input: string | undefined): number {
  if (input === undefined || input.trim() === '') {
    throw new CcxError(ErrorCode.INVALID_TARGET, 'Target tokens are required')
  }

  const normalized = input.replace(/,/g, '').trim().toLowerCase()

  // 1. 纯数字（允许小数形式输入，但最终须为正整数）：如 256000、300000
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const n = Number(normalized)
    if (!Number.isInteger(n) || n <= 0) {
      throw new CcxError(
        ErrorCode.INVALID_TARGET,
        `Invalid target tokens: ${input}`,
        'Target must be a positive integer'
      )
    }
    return n
  }

  // 2. shortVer 多段：每段「正整数 + 单位(k/w/m)」，如 27w、25w6k、1m23w4k。
  //    为什么支持多段：formatTokenCount 用求余链 M→w→k 生成多段 shortVer，
  //    parse 必须能反解，否则 parse(format(n))!==n 双向对称破裂（ADR 0003 决策 8）。
  if (/^(?:\d+[kwm])+$/.test(normalized)) {
    let total = 0
    for (const seg of normalized.matchAll(/(\d+)([kwm])/g)) {
      const val = parseInt(seg[1], 10)
      const mult = seg[2] === 'k' ? 1000 : seg[2] === 'w' ? 10000 : 1_000_000
      total += val * mult
    }
    if (total <= 0) {
      throw new CcxError(
        ErrorCode.INVALID_TARGET,
        `Invalid target tokens: ${input}`,
        'Target must be a positive integer'
      )
    }
    return total
  }

  throw new CcxError(
    ErrorCode.INVALID_TARGET,
    `Invalid target tokens: ${input}`,
    'Use a number like 256000, 270k, 27w, or 1m'
  )
}
