/**
 * 子包局部错误类型（避免循环依赖 root types/index.js）。
 * 复制 root 的 CcxError/ErrorCode 子集（encode-token-literal 用 INVALID_TARGET）。
 * 未来 CcxError 共享设计（ADR 待定）后，可统一到共享包。
 */
export enum ErrorCode {
  INVALID_TARGET = 'INVALID_TARGET',
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
 * 跨包 CcxError 类型守卫。
 *
 * 为什么不用 instanceof：root 与子包各有一份 CcxError 类（子包为避免循环依赖 root types
 * 而复制了一份），跨包 instanceof 必然失效。这里按 name + code 字段识别——两份 CcxError
 * 的 name 都设为 'CcxError'，故能统一识别。根治待单一 CcxError 来源（消除跨包双份）。
 */
export function isCcxError(e: unknown): e is CcxError {
  return e instanceof Error && e.name === 'CcxError' && typeof (e as CcxError).code === 'string'
}
