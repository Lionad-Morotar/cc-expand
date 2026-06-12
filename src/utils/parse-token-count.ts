/**
 * 解析用户输入的 token 数量
 * 支持：纯数字、千分位逗号、k/K（千）、w/W（万）后缀
 */
import { CcxError, ErrorCode } from '../types/index.js'

export function parseTokenCount(input: string | undefined): number {
  if (input === undefined || input.trim() === '') {
    throw new CcxError(ErrorCode.INVALID_TARGET, 'Target tokens are required')
  }

  const normalized = input.replace(/,/g, '').trim().toLowerCase()

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([kkw])?$/)
  if (!match) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${input}`,
      'Use a number like 256000, 270k, or 27w',
    )
  }

  const numericPart = parseFloat(match[1])
  const suffix = match[2]

  if (Number.isNaN(numericPart) || numericPart <= 0) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${input}`,
      'Target must be a positive integer',
    )
  }

  if (!Number.isInteger(numericPart) && suffix !== undefined) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${input}`,
      'Suffixes only support whole numbers',
    )
  }

  if (!Number.isInteger(numericPart)) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${input}`,
      'Target must be an integer',
    )
  }

  let multiplier = 1
  if (suffix === 'k') multiplier = 1000
  if (suffix === 'w') multiplier = 10000

  return numericPart * multiplier
}
