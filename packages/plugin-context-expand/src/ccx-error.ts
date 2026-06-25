/**
 * CcxError / ErrorCode 单一来源（ADR 0004）。
 *
 * 为什么放子包：root 依赖子包（workspace），子包不能依赖 root（循环），故跨包共享类型
 * 须定义在子包侧。root types/index.js re-export 此处，使 root 与子包用同一个 CcxError 类——
 * instanceof 跨包自然有效。演进：通用 errors 独立成 @cc-expand/errors 子包（当前 token 子包暂代）。
 */
export enum ErrorCode {
  BINARY_NOT_FOUND = 'BINARY_NOT_FOUND',
  PATTERN_NOT_FOUND = 'PATTERN_NOT_FOUND',
  PATCH_FAILED = 'PATCH_FAILED',
  CODESIGN_FAILED = 'CODESIGN_FAILED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  BACKUP_NOT_FOUND = 'BACKUP_NOT_FOUND',
  INVALID_TARGET = 'INVALID_TARGET',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SELF_UPDATE_FAILED = 'SELF_UPDATE_FAILED',
  PATTERN_DISCOVERY_FAILED = 'PATTERN_DISCOVERY_FAILED'
}

export class CcxError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public suggestion?: string,
  ) {
    super(message)
    this.name = 'CcxError'
  }
}

/**
 * CcxError 类型守卫。
 *
 * 单一来源后 instanceof 跨包已有效，但守卫仍保留——它对来自 JSON / 边界（非 Error 子类）
 * 的对象更稳健（只验 name + code 字段），且语义自文档化。
 */
export function isCcxError(e: unknown): e is CcxError {
  return e instanceof Error && e.name === 'CcxError' && typeof (e as CcxError).code === 'string'
}
