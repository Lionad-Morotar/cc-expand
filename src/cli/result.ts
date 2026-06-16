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
  /**
   * 成功结果的可视严重级别，供渲染器选色
   * - 'warning'：命令成功但状态需注意（如 verify 发现未 patch），渲染为黄色 [WARN]
   * - 默认 undefined：成功渲染为绿色 [OK]
   */
  severity?: 'ok' | 'warning'
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
  [ErrorCode.NETWORK_ERROR]: 69,
  [ErrorCode.SELF_UPDATE_FAILED]: 70,
  [ErrorCode.PATTERN_DISCOVERY_FAILED]: 70,
}

export function getExitCode(code?: ErrorCode): number {
  if (!code) return 1
  return EXIT_CODES[code] ?? 1
}

export function makeErrorResult<T = unknown>(
  command: string,
  code: ErrorCode,
  message: string,
  suggestion?: string,
): CommandResult<T> {
  return {
    success: false,
    command,
    summary: message,
    error: { code, message, suggestion },
  }
}
