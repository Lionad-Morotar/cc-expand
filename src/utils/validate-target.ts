/**
 * 校验 patch 目标输入是否可接受：能解析为正整数，且能在源槽位宽度内等长编码。
 *
 * 为什么存在：patch 的交互式输入校验。等长数值编码（见 ADR-0002）使 7 位目标
 * （如 100w → 1e6）也可接受——校验依据是「可编码性」而非「十进制位数」。
 *
 * @param value 用户原始输入（如 '256000'、'100w'）
 * @param sourceValue 源槽位值（如 '200000'），其长度决定槽位宽度
 * @returns true 表示可接受；string 表示拒绝原因（供 inquirer validate 显示）
 */
import { parseTokenCount } from './parse-token-count.js'
import { encodeTokenLiteral } from './encode-token-literal.js'
import { CcxError } from '../types/index.js'

export function validateTargetInput(value: string, sourceValue: string): true | string {
  try {
    const parsed = parseTokenCount(value)
    encodeTokenLiteral(parsed, sourceValue.length)
    return true
  } catch (e) {
    return (e as Error).message
  }
}
