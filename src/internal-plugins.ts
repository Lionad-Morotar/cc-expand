/**
 * internal plugin 定义集。
 *
 * 当前唯一 internal：token-expansion。token 工具（formatTokenCount/encodeTokenLiteral/parseTokenCount）
 * 统一从子包 @cc-expand/plugin-context-expand import——子包是 token 逻辑的唯一真相来源，
 * root utils 仅作公共 API re-export 兼容层，不再在此间接绕一层。
 *
 * 提取到共享模块：cli/index.ts（plugins 命令）与 patch.ts（patch 命令）共用同一份定义。
 */
import { formatTokenCount, encodeTokenLiteral, parseTokenCount } from '@cc-expand/plugin-context-expand'
import type { InternalPluginDefinition } from './types/plugins.js'

export const TOKEN_EXPANSION: InternalPluginDefinition = {
  manifest: {
    name: 'token-expansion',
    shardBaseUrl: 'https://cc-expand.oss-cn-shanghai.aliyuncs.com/patterns/',
    target: { type: 'token-encode' },
    shortVer: { kind: 'token-target' }
  },
  strategies: {
    shortVer: ctx => formatTokenCount(ctx.targetTokens ?? 0),
    targetEncode: (slot, ctx) => encodeTokenLiteral(ctx.targetTokens ?? 0, slot),
    parseInput: parseTokenCount
  }
}

/** 所有 internal plugins（PluginsManager 注入用） */
export const INTERNAL_PLUGINS: InternalPluginDefinition[] = [TOKEN_EXPANSION]
