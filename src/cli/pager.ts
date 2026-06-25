/**
 * 交互式版本列表 pager
 *
 * 语义是「浏览」而非「选择」：q/Esc 退出，不返回任何业务值。
 * 通过 @inquirer/core 的 createPrompt + usePagination + useKeypress 自定义实现，
 * 不向外部暴露任何选择结果。runPager 仅负责把 lines 渲染成一个可翻页视图并在退出后清理。
 *
 * Why 动态 import @inquirer/core：与 patch.ts 的现有先例一致，避免 CLI 冷启动时
 * 强制加载 inquirer runtime；pager 只在交互分支才会走到。
 */

import { t } from './i18n.js'

export const DEFAULT_PAGE_SIZE = 10

export interface PagerOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  pageSize?: number
}

/**
 * 运行一个浏览式 pager。
 *
 * @param lines 已格式化好的版本行（由 formatVersionLine 产出）
 * @returns 永远 resolve 为 void；用户退出（q/Esc）或 Ctrl-C 都干净退出
 */
export async function runPager(lines: string[], opts: PagerOptions = {}): Promise<void> {
  if (lines.length === 0) return
  const input = opts.input ?? process.stdin
  const output = opts.output ?? process.stdout

  // Why 自适应高度：usePagination 会把输出强制填到恰好 pageSize 行，
  // 加上 footer(1) + (调用方)summary(1) 共 2 行非列表开销。终端高度不足时
  // （tmux 分屏、VSCode 内嵌终端 8 行高）会产生滚动残影/抖动，且溢出行
  // 留在回滚缓冲里。这里按实际可视行数 clamp，-2 给 footer 与 summary 预留。
  // 非 TTY 输出（shouldUsePager 已在上游挡住，这里做防御性兜底）回落到默认值。
  const termRows
    = ((output as { rows?: number }).rows ?? process.stdout.rows ?? 0) as number
  const heightClamped = termRows > 0 ? Math.max(3, Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, termRows - 2)) : (opts.pageSize ?? DEFAULT_PAGE_SIZE)
  const pageSize = heightClamped

  // 动态 import，与 patch.ts 先例保持一致
  const { createPrompt, useKeypress, usePagination, useState } = await import('@inquirer/core')

  type BrowseResult = null

  // Why createPrompt：它接管 readline/raw mode 并提供 hook 容器；clearPromptOnDone:true
  // 让 inquirer 在 done() 后自行清屏，我们再补写 summary + hint。
  const browse = createPrompt<BrowseResult, { lines: string[], pageSize: number }>(
    (config, done) => {
      const [active, setActive] = useState(0)
      const total = config.lines.length

      const page = usePagination({
        items: config.lines,
        active,
        pageSize: config.pageSize,
        loop: false,
        renderItem: ({ item, isActive }) => {
          const pointer = isActive ? '❯' : ' '
          return `${pointer} ${item}`
        }
      })

      useKeypress((key) => {
        const name = key.name
        const ctrl = key.ctrl === true
        // @inquirer/core 的 KeypressEvent 类型未声明 shift，但 readline/keypress 实际产出该字段
        //（Shift+G 区分依赖它，见下方跳末行分支），故局部断言而非删除
        const shift = (key as { shift?: boolean }).shift === true
        // 行翻：上/下箭头、j/k
        // Why 直接值而非函数式更新：@inquirer/core 的 useState 不支持 (prev)=>next
        // （与 React 不同），传函数会被当作字面值存入 state，导致 active 变成函数对象、
        // footer 渲染出函数源码（形如 line (cur)=>…1/12）。useKeypress 每次 render
        // 重新注册回调，闭包里的 active 即为最新值，直接用它计算新值即可。
        if (name === 'up' || name === 'k') {
          setActive(Math.max(0, active - 1))
          return
        }
        if (name === 'down' || name === 'j') {
          setActive(Math.min(total - 1, active + 1))
          return
        }
        // 页翻：Space/PgDn/Ctrl-F 向下，b/PgUp/Ctrl-B 向上
        if (name === 'space' || name === 'pagedown' || (ctrl && name === 'f')) {
          setActive(Math.min(total - 1, active + config.pageSize))
          return
        }
        if (name === 'pageup' || name === 'b' || (ctrl && name === 'b')) {
          setActive(Math.max(0, active - config.pageSize))
          return
        }
        // 跳首行：g（无 shift）。
        // Why 先判末行：readline/keypress 对所有字母键都会把 key.name 归一化为小写并
        // 设置 key.shift:true，故 Shift+G 实际产生 {name:'g', shift:true}，而非
        // {name:'G'}。原实现先命中 `name === 'g'` 分支导致 Shift+G 永远跳到首行，
        // `name === 'G'` 是不可达死代码。这里按 shift 修饰区分，顺序敏感：
        // 必须在无 shift 的 g 之前判断末行，否则会被首行分支抢先吃掉。
        if ((name === 'g' && shift) || name === 'end' || (ctrl && name === 'e')) {
          setActive(total - 1)
          return
        }
        if (name === 'g') {
          setActive(0)
          return
        }
        // 退出：q/Esc；Ctrl-C 由 inquirer 抛 ExitPromptError，由调用方 try/catch
        if (name === 'q' || name === 'escape') {
          done(null)
          return
        }
        // 回车作为浏览结束（与 q 等价），符合直觉
        if (name === 'return' || name === 'enter') {
          done(null)
        }
      })

      // footer 走 i18n：pager 是 supports/list 的交互入口，en 用户不应看到中文提示
      const footer = t('ui.pagerFooter', { line: active + 1, total })
      return `${page}\n${footer}`
    }
  )

  try {
    await browse({ lines, pageSize }, {
      input,
      output,
      clearPromptOnDone: true
    })
  } catch (err) {
    // Ctrl-C 抛 ExitPromptError：清理已由 inquirer 在 close 时完成；
    // 必须兜底，否则未恢复的 raw mode 或未捕获的 rejection 会污染主进程
    if (!isExitPromptError(err)) {
      throw err
    }
  }
}

function isExitPromptError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && (err as { name?: string }).name === 'ExitPromptError'
  )
}
