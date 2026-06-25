/**
 * @cc-expand/plugin-context-expand —— token-expansion internal plugin 包
 *
 * 当前期：仅 export formatTokenCount（token shortVer 计算）。
 * 后续（ADR 0003 搬迁）：encodeTokenLiteral / parseTokenCount / token-expansion InternalPluginDefinition
 * 全部迁入此包，root 内核通过 workspace 依赖 import（bundled：tsup inline 进 ccx dist）。
 */
export { formatTokenCount } from './format-token-count.js'
export { encodeTokenLiteral } from './encode-token-literal.js'
export { parseTokenCount } from './parse-token-count.js'
export { isCcxError } from './ccx-error.js'
