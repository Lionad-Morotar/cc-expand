/**
 * 启发式 desc 归类:为 PatternDiscovery 产出的 search 打语义标签
 *
 * patch 引擎不依赖 desc(只用 search + sourceValue),故归类误判不影响 patch 功能,仅影响可读性。
 * skill tool budget 与 other context limit 难以靠伴生数值稳定区分,统一兜底为 context-window-limit。
 */

/**
 * 根据伴生字段特征归类 search
 * 注意:=20000 必须排除 =200000(20000 是 200000 的前缀子串,朴素 includes 会误判)
 */
export function classifyDesc(search: string): string {
  if (search.includes('>200000')) return 'exceeds200k threshold'
  if (/=1536(?![0-9])/.test(search)) return 'teamMemorySync'
  if (/=50(?![0-9])/.test(search)) return 'MAX_TOOL_RESULTS_PER_MESSAGE'
  if (/=20000(?![0-9])/.test(search)) return 'MODEL_CONTEXT_WINDOW_DEFAULT'
  return 'context-window-limit'
}
