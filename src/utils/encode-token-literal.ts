/** ADR 0003：encodeTokenLiteral 已搬入子包 @cc-expand/plugin-context-expand。
 *  此处 re-export 保持向后兼容（root 代码 import from '../utils/encode-token-literal.js' 不变）。
 *  完整文档与实现见 packages/plugin-context-expand/src/encode-token-literal.ts。 */
export { encodeTokenLiteral } from '@cc-expand/plugin-context-expand'
