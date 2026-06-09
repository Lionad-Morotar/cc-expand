/**
 * 错误码枚举
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
}

/**
 * cc-expand 统一错误类
 * 包含错误码、用户消息和修复建议
 */
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
 * 单个 patch 项
 */
export interface PatchItem {
  /** 搜索模式（包含版本特定变量名和常量值） */
  search: string
  /** 描述 */
  desc: string
  /** 源常量值 */
  sourceValue: string
}

/**
 * 版本配置
 */
export interface VersionConfig {
  patches: PatchItem[]
}

/**
 * Patch 配置
 */
export interface PatchConfig {
  /** 目标 tokens 数值 */
  targetTokens: number
  /** 二进制文件路径 */
  binaryPath: string
  /** 搜索模式 */
  searchPattern: string
  /** 替换模式（模板，包含 {{tokens}} 占位） */
  replaceTemplate: string
}

/**
 * Patch 结果
 */
export interface PatchResult {
  /** 是否成功 */
  success: boolean
  /** 实际替换的模式（已填充 tokens） */
  replacedPattern?: string
  /** 替换次数 */
  replaceCount?: number
  /** 备份路径 */
  backupPath?: string
  /** 错误信息 */
  error?: CcxError
}
