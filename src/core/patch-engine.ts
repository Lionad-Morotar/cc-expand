/**
 * 核心 patch 引擎
 * 负责在二进制文件中搜索并替换常量字符串
 */
import { type PatchItem, type PatchResult, CcxError, ErrorCode } from '../types/index.js'
import { isCcxError } from '@cc-expand/plugin-context-expand'

export interface PatchDetail {
  desc?: string
  offset: number
  sourceValue: string
  targetValue: string
}

/**
 * latin1 单字节语义的入口校验：>U+00FF 的字符会被 Buffer 的 latin1 写入截断为低字节
 * （如 '中'→0x2D），静默截断会把「编码不命中→PATTERN_NOT_FOUND」的 fail-safe 退化成
 * 可能错位命中后写入。误写字面量（未按 \u00XX 转义）的 shard 须显式拒收。
 * 仅需引擎侧拦截：Verifier 只在本引擎成功后被调用，非法输入到不了 verify
 */
function assertLatin1Representable(str: string, label: string): void {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code > 0xff) {
      throw new CcxError(
        ErrorCode.INVALID_TARGET,
        `${label} contains non-latin1 char U+${code.toString(16).toUpperCase().padStart(4, '0')} at index ${i}; escape as \\u00XX in the shard`
      )
    }
  }
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
  patch(
    buffer: Buffer,
    patches: PatchItem[],
    targetGenerator: (slot: number) => string
  ): PatchResult & { details: PatchDetail[] } {
    let totalPatches = 0
    const details: PatchDetail[] = []
    // token-encode 策略由调用方注入（内核零 token 知识：本引擎不认识 token/encode，只按 slot 长度生成等长字面量）
    const gen = targetGenerator

    // 预编码所有 item：literal target 用 value（+pad），否则 token-encode。
    // 任一无法等长编码则整体失败，buffer 不被修改（原子性）
    let encoded: string[]
    try {
      encoded = patches.map((item, i) => {
        assertLatin1Representable(item.search, `patches[${i}].search`)
        assertLatin1Representable(item.sourceValue, `patches[${i}].sourceValue`)
        if (item.target) {
          const slot = item.sourceValue.length
          const v = item.target.pad === 'right-space' ? item.target.value.padEnd(slot, ' ') : item.target.value
          if (v.length > slot) {
            throw new CcxError(ErrorCode.INVALID_TARGET, `literal target ${v.length}B > slot ${slot}B`)
          }
          if (v.length !== slot) {
            throw new CcxError(
              ErrorCode.INVALID_TARGET,
              `literal target length ${v.length}B != slot ${slot}B; add pad:"right-space" or adjust value`
            )
          }
          assertLatin1Representable(v, `patches[${i}].target.value`)
          return v
        }
        const literal = gen(item.sourceValue.length)
        assertLatin1Representable(literal, `patches[${i}] encoded literal`)
        return literal
      })
    } catch (e) {
      // 跨包 CcxError 识别用 isCcxError 守卫（instanceof 跨包失效，见子包 ccx-error.ts）
      const code = isCcxError(e) ? e.code : undefined
      return {
        success: false,
        replaceCount: 0,
        details,
        error: code === ErrorCode.INVALID_TARGET
          ? new CcxError(ErrorCode.INVALID_TARGET, (e as Error).message)
          : new CcxError(ErrorCode.PATCH_FAILED, String(e))
      }
    }

    for (let i = 0; i < patches.length; i++) {
      const { search, desc, sourceValue } = patches[i]
      const targetStr = encoded[i]
      // latin1 而非 utf8：search/sourceValue 承载任意字节（installed plugin 的 bytecode
      // 指令锚点含 >=0x80 字节，JSON 以 \u00XX 转义进来）；utf8 会双字节化致搜索错位。
      // ASCII 区间两者编码一致，token pattern 行为不变
      const searchBuf = Buffer.from(search, 'latin1')
      const sourceOffsetInSearch = search.indexOf(sourceValue)

      if (sourceOffsetInSearch === -1) {
        continue // 模式中不包含 sourceValue，跳过
      }

      let offset = 0
      while (true) {
        const idx = buffer.indexOf(searchBuf, offset)
        if (idx === -1) break

        const replaceAt = idx + sourceOffsetInSearch
        const verify = buffer.subarray(replaceAt, replaceAt + sourceValue.length).toString('latin1')
        if (verify !== sourceValue) {
          offset = idx + 1
          continue
        }

        buffer.write(targetStr, replaceAt, 'latin1')
        totalPatches++
        details.push({
          desc,
          offset: replaceAt,
          sourceValue,
          targetValue: targetStr
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
          'Check patterns.json for supported versions or run: grep -ao "200000" <binary>'
        )
      }
    }

    return {
      success: true,
      replaceCount: totalPatches,
      details
    }
  }
}
