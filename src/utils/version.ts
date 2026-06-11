/**
 * 版本号规范化工具
 *
 * 统一处理用户输入的版本号：
 * - 去掉前导 v（如 v2.1.172 → 2.1.172）
 * - 保留 latest 等特殊标识
 */

/**
 * 规范化版本号字符串
 * @param version 原始版本号，如 "v2.1.172"、"2.1.172"、"latest"
 * @returns 去掉 v 前缀后的版本号
 */
export function normalizeVersion(version: string): string {
  if (version.startsWith('v')) {
    return version.slice(1)
  }
  return version
}

/**
 * 验证版本号格式是否合法
 * @param version 版本号
 * @returns 是否合法
 */
export function isValidVersion(version: string): boolean {
  const normalized = normalizeVersion(version)
  if (normalized === 'latest') return true
  return /^\d+\.\d+\.\d+/.test(normalized)
}
