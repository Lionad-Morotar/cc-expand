/**
 * CLI 输出格式化工具
 * 统一所有命令的输出格式：第一行固定 [STATUS] 摘要，后续为详细说明
 */

/**
 * 生成第一行摘要，固定格式 `[STATUS] message`
 * STATUS ∈ {OK, WARN, ERROR, INFO}
 */
export function formatSummary(status: string, message: string): string {
  return `[${status}] ${message}`
}

/**
 * 对关键字加 ANSI cyan 高亮
 */
export function highlight(text: string): string {
  return `\x1b[36m${text}\x1b[0m`
}

/**
 * 格式化警告列表
 * 空数组返回空字符串，否则输出带 ⚠ 前缀的警告块
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return ''
  const lines = warnings.map((w) => `  ${w}`)
  return `\n⚠ 注意：\n${lines.join('\n')}`
}

/**
 * 格式化建议操作列表
 * 空数组返回空字符串，否则输出带编号的建议块
 */
export function formatNextSteps(steps: string[]): string {
  if (steps.length === 0) return ''
  const lines = steps.map((s, i) => `  ${i + 1}. ${s}`)
  return `\n建议操作：\n${lines.join('\n')}`
}
