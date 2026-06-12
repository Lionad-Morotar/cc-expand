/**
 * 命令结果类型与 BSD 风格退出码
 */
import { ErrorCode } from '../types/index.js'

export interface CommandResult<T = unknown> {
  success: boolean
  command: string
  summary: string
  data?: T
  next?: string[]
  warnings?: string[]
  error?: { code: string; message: string; suggestion?: string }
}

export const EXIT_CODES: Record<ErrorCode, number> = {
  [ErrorCode.INVALID_TARGET]: 64,
  [ErrorCode.BINARY_NOT_FOUND]: 69,
  [ErrorCode.PATTERN_NOT_FOUND]: 69,
  [ErrorCode.PATCH_FAILED]: 70,
  [ErrorCode.CODESIGN_FAILED]: 70,
  [ErrorCode.VERIFICATION_FAILED]: 70,
  [ErrorCode.BACKUP_NOT_FOUND]: 70,
  [ErrorCode.PERMISSION_DENIED]: 77,
}

export function getExitCode(code?: ErrorCode): number {
  if (!code) return 1
  return EXIT_CODES[code] ?? 1
}

export function makeErrorResult(
  command: string,
  code: ErrorCode,
  message: string,
  suggestion?: string,
): CommandResult {
  return {
    success: false,
    command,
    summary: message,
    error: { code, message, suggestion },
  }
}
