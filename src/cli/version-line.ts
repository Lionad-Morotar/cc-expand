/**
 * 版本行格式化
 *
 * 单一事实源：renderer 的静态输出和 pager 的动态输出共用 formatVersionLine，
 * 保证两处渲染逐字符一致（核心不变量）。
 * 视口/分页交给 @inquirer/core 的 usePagination 处理，本模块不重复实现，
 * 避免维护一套生产环境永不调用的窗口算法（曾经的 computeWindow 即属此类死代码）。
 */

/**
 * 版本项的最小结构契约。
 * 兼容 supports（version/platforms/current）与 list（version/installed/patched/targets）。
 * 字段全部可选，由调用方按需填充。
 */
export interface VersionLineItem {
  version?: string
  platforms?: string[]
  installed?: boolean
  patched?: boolean
  targets?: number[] | string[]
  combos?: string[]
  current?: boolean
}

/**
 * 把单个版本项格式化为单行字符串。
 *
 * Why 逐字符匹配 renderer 原实现：列表类命令的静态输出已被外部脚本/测试固定，
 * 任何细节差异（空格、箭头方向、标记顺序）都会破坏一致性。故保留原顺序：
 * 缩进 + 版本号 + 平台 + installed + patched + targets + current 标记。
 */
export function formatVersionLine(item: VersionLineItem): string {
  const version = String(item.version ?? '')
  const current = item.current ? ' ← current' : ''
  const platforms = Array.isArray(item.platforms)
    ? ` (${item.platforms.join(', ')})`
    : ''
  const installed = item.installed === true ? ' [installed]' : ''
  const patched = item.patched === true ? ' [patched]' : ''
  // plugin 体系：combo 是 binary 命名的权威标识，优先展示；老数据 fallback 到 targets
  const display = Array.isArray(item.combos) && item.combos.length > 0
    ? item.combos
    : (Array.isArray(item.targets) ? item.targets : [])
  const targets = display.length > 0 ? ` → ${display.join(', ')}` : ''
  return `  ${version}${platforms}${installed}${patched}${targets}${current}`
}
