/**
 * 核心 patch 引擎
 * 负责在二进制文件中搜索并替换常量字符串
 */
import { type PatchItem, type PatchResult, CcxError, ErrorCode } from '../types/index.js'
import { encodeTokenLiteral } from '../utils/encode-token-literal.js'

export interface PatchDetail {
  desc: string
  offset: number
  sourceValue: string
  targetValue: string
}

export class PatchEngine {
  /**
   * 在二进制缓冲区中搜索并替换多个模式
   * 模仿 patch-claude-context.js 的逻辑：
   * - 搜索包含版本特定变量名的模式
   * - 只替换其中的数字部分
   * @param buffer 二进制文件内容
   * @param patches PatchItem 数组
   * @param targetTokens 目标 tokens 数值
   * @returns Patch 结果
   */
  patch(buffer: Buffer, patches: PatchItem[], targetTokens: number): PatchResult & { details: PatchDetail[] } {
    let totalPatches = 0
    const details: PatchDetail[] = []

    // 预编码所有 item：任一目标无法在槽位内等长编码则整体失败，buffer 不被修改（原子性）
    let encoded: string[]
    try {
      encoded = patches.map(item => encodeTokenLiteral(targetTokens, item.sourceValue.length))
    } catch (e) {
      return {
        success: false,
        replaceCount: 0,
        details,
        error: e instanceof CcxError ? e : new CcxError(ErrorCode.PATCH_FAILED, String(e)),
      }
    }

    for (let i = 0; i < patches.length; i++) {
      const { search, desc, sourceValue } = patches[i]
      const targetStr = encoded[i]
      const searchBuf = Buffer.from(search, 'utf8')
      const sourceOffsetInSearch = search.indexOf(sourceValue)

      if (sourceOffsetInSearch === -1) {
        continue // 模式中不包含 sourceValue，跳过
      }

      let offset = 0
      while (true) {
        const idx = buffer.indexOf(searchBuf, offset)
        if (idx === -1) break

        const replaceAt = idx + sourceOffsetInSearch
        const verify = buffer.subarray(replaceAt, replaceAt + sourceValue.length).toString('utf8')
        if (verify !== sourceValue) {
          offset = idx + 1
          continue
        }

        buffer.write(targetStr, replaceAt)
        totalPatches++
        details.push({
          desc,
          offset: replaceAt,
          sourceValue,
          targetValue: targetStr,
        })
        offset = idx + searchBuf.length
      }
    }

    if (totalPatches === 0) {
      return {
        success: false,
        replaceCount: 0,
        details,
        error: new CcxError(
          ErrorCode.PATTERN_NOT_FOUND,
          'No patches applied. Binary may be a different version with unknown constant names.',
          'Check patterns.json for supported versions or run: grep -ao "200000" <binary>',
        ),
      }
    }

    return {
      success: true,
      replaceCount: totalPatches,
      details,
    }
  }
}
