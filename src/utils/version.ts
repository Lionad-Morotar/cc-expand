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

/**
 * 比较 a 是否严格大于 b（按 semver 主.次.修 数字逐位比较）
 * 非法或缺失段视为 0。用于 status/list 判断 npm latest 是否新于当前版本。
 */
export function isVersionGreater(a: string, b: string): boolean {
  const segs = (v: string) => (v.match(/\d+/g) ?? []).map(n => parseInt(n, 10))
  const aa = segs(a)
  const bb = segs(b)
  // 至少需要 major.minor 两段才可比，否则保守判定不更新（避免畸形版本如 '2.1.x-beta' 误报）
  if (aa.length < 2 || bb.length < 2) return false
  for (let i = 0; i < Math.max(aa.length, bb.length, 3); i++) {
    const x = aa[i] ?? 0
    const y = bb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/**
 * 判定版本是否走 Bun bytecode 编译（2.1.246 起全面启用）。
 * Why：bytecode 编译后运行时执行的是常量池内联字节，文本替换只改嵌入源文本，
 * 无 bytecode 锚点的平台 patch 会「报告成功但运行时上下文窗口不变」，需要警告。
 */
export function isBytecodeVersion(version: string): boolean {
  return isVersionGreater(version, '2.1.245')
}
