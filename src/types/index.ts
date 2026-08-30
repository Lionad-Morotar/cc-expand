// CcxError / ErrorCode 单一来源在 @cc-expand/plugin-context-expand（ADR 0004）：
// root 依赖子包、子包不能依赖 root（循环），故共享类型定义在子包侧；root re-export 保持
// 现有 import 路径（from '../types/index.js'）不变，root 与子包用同一个类——instanceof 跨包有效。
import { CcxError, ErrorCode, isCcxError } from '@cc-expand/plugin-context-expand'

export { CcxError, ErrorCode, isCcxError }

/**
 * cc-expand 自身的安装方式（区别于 channel：channel 指 CC 二进制渠道）
 * 用于 self-update 决定执行哪条更新命令
 * @see CONTEXT.md — installMethod 与 channel 的术语区分
 */
export type InstallMethod = 'npm' | 'pnpm' | 'yarn' | 'npx' | 'unknown'

/**
 * 单个 patch 项
 */
export interface PatchItem {
  /** 搜索模式（包含版本特定变量名和常量值） */
  search: string
  /** 描述（可选，patch 结果展示用） */
  desc?: string
  /** 源常量值（被覆盖的子串；其长度 = 等长槽位宽度） */
  sourceValue: string
  /** literal target：固定等长替换（installed plugin 用）；省略则走 token-encode（internal token-expansion） */
  target?: { value: string, pad?: 'right-space' }
  /** bytecode 常量池字节锚点（hex，支持 {{tokens}} 占位符标记 token 槽位）。
   *  CC 2.1.246+ native binary 的常量内联在 bytecode 常量池，文本替换无效，需字节锚点。
   *  挂在任一 patch 项上即可，applier 聚合去重后统一交给 BytecodePatchEngine。 */
  bytecodePatterns?: string[]
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
