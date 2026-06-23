/**
 * pager + 版本行工具测试
 *
 * formatVersionLine 是纯函数，断言其与 renderer 静态输出逐字符一致（核心不变量）；
 * runPager 注入伪造的 TTY 输入流喂入按键序列，验证导航与退出语义。
 */
import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import {
  formatVersionLine,
  type VersionLineItem,
} from '../../src/cli/version-line.js'
import { runPager, DEFAULT_PAGE_SIZE } from '../../src/cli/pager.js'
import { createRenderer } from '../../src/cli/renderer.js'

describe('formatVersionLine', () => {
  it('matches renderer static output byte-for-byte (supports data)', () => {
    const item: VersionLineItem = {
      version: '2.1.170',
      platforms: ['darwin-arm64', 'linux-x64'],
      current: false,
    }
    const expected = '  2.1.170 (darwin-arm64, linux-x64)'
    expect(formatVersionLine(item)).toBe(expected)

    // 与 renderer 静态输出逐字符相等（核心不变量）
    const renderer = createRenderer({ color: false, locale: 'en' })
    const rendered = renderer.render(
      {
        success: true,
        command: 'supports',
        summary: 'Supported: 1',
        data: { versions: [item] },
      },
      'supports',
    )
    expect(rendered).toContain(expected)
  })

  it('matches renderer static output byte-for-byte (list data with all flags)', () => {
    const item: VersionLineItem = {
      version: '2.1.170',
      installed: true,
      patched: true,
      targets: [256000, 270000],
      current: false,
    }
    const expected = '  2.1.170 [installed] [patched] → 256000, 270000'
    expect(formatVersionLine(item)).toBe(expected)

    const renderer = createRenderer({ color: false, locale: 'en' })
    const rendered = renderer.render(
      {
        success: true,
        command: 'list',
        summary: 'Installed: 1',
        data: { versions: [item] },
      },
      'list',
    )
    expect(rendered).toContain(expected)
  })

  it('appends ← current marker at the end of the line', () => {
    const item: VersionLineItem = {
      version: '2.1.170',
      platforms: ['darwin-arm64'],
      current: true,
    }
    expect(formatVersionLine(item)).toBe('  2.1.170 (darwin-arm64) ← current')
  })

  it('omits platforms/targets when absent', () => {
    const item: VersionLineItem = { version: '2.1.170' }
    expect(formatVersionLine(item)).toBe('  2.1.170')
  })

  it('does not mark installed/patched when falsy', () => {
    const item: VersionLineItem = { version: '1.0.0', installed: false, patched: false }
    expect(formatVersionLine(item)).toBe('  1.0.0')
  })

  it('handles empty version gracefully', () => {
    expect(formatVersionLine({})).toBe('  ')
  })
})

describe('DEFAULT_PAGE_SIZE', () => {
  it('is 10', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10)
  })
})

describe('runPager', () => {
  /**
   * 构造一个伪造的 TTY 输入流：
   * readline 检测 isTTY 决定 raw 行为，setRawMode 为 no-op；
   * 在下一 tick 通过 emit 'keypress' 发送按键序列。
   *
   * Why 修饰键字段：readline/keypress 对字母键会把 key.name 归一化为小写并
   * 设置 key.shift / key.ctrl，故 Shift+G 必须用 { name:'g', shift:true } 模拟，
   * 而非 { name:'G' }（后者在生产环境永远不会出现）。
   */
  function makeFakeInput(
    keySequence: Array<{ name: string; shift?: boolean; ctrl?: boolean }>,
  ): Readable {
    const stream = new Readable({ read() {} })
    stream.isTTY = true
    ;(stream as unknown as { setRawMode: () => void }).setRawMode = () => {}
    setTimeout(() => {
      for (const key of keySequence) {
        stream.emit('keypress', null, key)
      }
    }, 5)
    return stream
  }

  function makeFakeOutput(rows?: number): { stream: Writable; chunks: string[] } {
    const chunks: string[] = []
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk.toString())
        cb()
      },
    })
    if (rows !== undefined) {
      ;(stream as unknown as { rows: number }).rows = rows
    }
    return { stream, chunks }
  }

  it('resolves cleanly when user presses q', async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `  v1.0.${i}`)
    const input = makeFakeInput([{ name: 'q' }])
    const { stream: output } = makeFakeOutput()

    await expect(
      runPager(lines, { input, output, pageSize: 10 }),
    ).resolves.toBeUndefined()
  }, 5000)

  it('resolves after navigating then pressing q', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `  v2.0.${i}`)
    const input = makeFakeInput([
      { name: 'down' },
      { name: 'down' },
      { name: 'space' },
      { name: 'pagedown' },
      { name: 'g', shift: true },
      { name: 'g' },
      { name: 'q' },
    ])
    const { stream: output } = makeFakeOutput()

    await expect(
      runPager(lines, { input, output, pageSize: 10 }),
    ).resolves.toBeUndefined()
  }, 5000)

  /**
   * Why 这个回归断言：@inquirer/core 的 useState 不支持函数式更新，曾用
   * setActive((cur)=>...) 导致 active 变成函数对象、footer 渲染出函数源码
   * （形如 `line (cur) => Math.min(...)1/12`）。按 down 后 active 必须是数字 1，
   * footer 显示 line 2/12，且整个输出不含 '=>'。
   */
  it('arrow down keeps footer line number numeric (no function-state leak)', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `  v9.0.${i}`)
    const input = makeFakeInput([{ name: 'down' }, { name: 'q' }])
    const { stream: output, chunks } = makeFakeOutput()

    await runPager(lines, { input, output, pageSize: 10 })

    const joined = chunks.join('')
    expect(joined).toContain('line 2/12')
    expect(joined).not.toContain('=>')
  }, 5000)

  it('space pages down keeping footer line number numeric', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `  v10.0.${i}`)
    const input = makeFakeInput([{ name: 'space' }, { name: 'q' }])
    const { stream: output, chunks } = makeFakeOutput()

    await runPager(lines, { input, output, pageSize: 10 })

    const joined = chunks.join('')
    expect(joined).toContain('line 11/25')
    expect(joined).not.toContain('=>')
  }, 5000)

  /**
   * Why 这个回归断言：原实现的 `name === 'G'` 是死代码（Shift+G 实际产生
   * {name:'g', shift:true}，先被 `name === 'g'` 首行分支吃掉），footer 永远
   * 停在 line 1/25。这里 down 一次到 line 2，再 Shift+G 必须跳到末行 line 25，
   * 以 footer 文本作为 active 状态的可观察锚点。
   */
  it('Shift+G jumps to the last line (shift modifier path)', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `  v4.0.${i}`)
    const input = makeFakeInput([
      { name: 'down' },
      { name: 'g', shift: true },
      { name: 'q' },
    ])
    const { stream: output, chunks } = makeFakeOutput()

    await runPager(lines, { input, output, pageSize: 10 })

    const joined = chunks.join('')
    expect(joined).toContain('line 25/25')
  }, 5000)

  it('Ctrl-E jumps to the last line', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `  v5.0.${i}`)
    const input = makeFakeInput([
      { name: 'e', ctrl: true },
      { name: 'q' },
    ])
    const { stream: output, chunks } = makeFakeOutput()

    await runPager(lines, { input, output, pageSize: 10 })

    expect(chunks.join('')).toContain('line 25/25')
  }, 5000)

  it('clamps pageSize to terminal height - 2 in low-height terminals', async () => {
    // 8 行高的终端：pageSize 应 clamp 到 max(3, 8-2)=6，而非请求的 10
    const lines = Array.from({ length: 25 }, (_, i) => `  v6.0.${i}`)
    const input = makeFakeInput([{ name: 'q' }])
    const { stream: output, chunks } = makeFakeOutput(8)

    await runPager(lines, { input, output, pageSize: 10 })

    const joined = chunks.join('')
    // usePagination 会渲染恰好 pageSize 行列表，clamp 到 6 后末行可见的是 v6.0.5..v6.0.??
    // 关键不变量：不应渲染到 v6.0.9（即第 10 项），证明 pageSize 未保持为 10
    expect(joined).not.toContain('v6.0.9')
  }, 5000)

  it('keeps pageSize when terminal height is sufficient', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `  v7.0.${i}`)
    const input = makeFakeInput([{ name: 'q' }])
    // 24 行终端：pageSize 10 仍可用（10 <= 24-2）
    const { stream: output, chunks } = makeFakeOutput(24)

    await runPager(lines, { input, output, pageSize: 10 })

    const joined = chunks.join('')
    expect(joined).toContain('v7.0.0')
  }, 5000)

  it('resolves on Esc', async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `  v3.0.${i}`)
    const input = makeFakeInput([{ name: 'escape' }])
    const { stream: output } = makeFakeOutput()

    await expect(
      runPager(lines, { input, output, pageSize: 10 }),
    ).resolves.toBeUndefined()
  }, 5000)

  it('is a no-op for empty lines', async () => {
    const { stream: output } = makeFakeOutput()
    await expect(runPager([], { output })).resolves.toBeUndefined()
  })

  it('handles Ctrl-C (ExitPromptError) by catching internally', async () => {
    // Ctrl-C 在 inquirer 中经 readline 的 SIGINT 事件路径抛 ExitPromptError；
    // 在伪造流上 emit { name: 'c', ctrl: true } 即可触发该路径
    const lines = Array.from({ length: 15 }, () => '  x')
    const input = makeFakeInput([{ name: 'c', ctrl: true }])
    const { stream: output } = makeFakeOutput()

    await expect(
      runPager(lines, { input, output, pageSize: 10 }),
    ).resolves.toBeUndefined()
  }, 5000)
})
