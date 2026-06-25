/**
 * @cc-expand/plugin-context-expand —— token-expansion internal plugin 包
 *
 * export token 工具（formatTokenCount / encodeTokenLiteral / parseTokenCount）与 isCcxError 跨包守卫。
 * root 内核经 workspace 依赖 import；运行时由 tsup inline bundle 进 ccx dist。
 */
export { formatTokenCount } from './format-token-count.js'
export { encodeTokenLiteral } from './encode-token-literal.js'
export { parseTokenCount } from './parse-token-count.js'
export { CcxError, ErrorCode, isCcxError } from './ccx-error.js'
