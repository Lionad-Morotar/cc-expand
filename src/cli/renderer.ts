/**
 * CLI 输出渲染层
 * 根据 flags 决定：彩色/无彩色、安静模式、JSON 信封、语言
 */
import { isatty } from 'node:tty'
import { createColors } from 'picocolors'
import { t, setLocale, normalizeLocale, type Locale } from './i18n.js'
import type { CommandResult } from './result.js'

export interface RendererOptions {
  color?: boolean
  quiet?: boolean
  json?: boolean
  locale?: Locale
}

export function createRenderer(options: RendererOptions = {}) {
  let color = options.color ?? true

  if (process.env.NO_COLOR || process.env.TERM === 'dumb' || !isatty(process.stdout.fd)) {
    color = false
  }

  const pc = createColors(color)

  return {
    render(result: CommandResult, commandName: string): string | undefined {
      // renderer 自包含 locale：render 时同步全局 i18n，避免依赖外部 setLocale 调用顺序
      setLocale(normalizeLocale(options.locale))
      if (options.json) {
        const envelope = {
          ...result,
          locale: options.locale ?? 'en',
        }
        return JSON.stringify(envelope, null, 2)
      }

      if (options.quiet && result.success) {
        return undefined
      }

      const lines: string[] = []

      if (!result.success) {
        lines.push(`${pc.red('[ERROR]')} ${result.error?.message ?? result.summary}`)
        if (result.error?.suggestion) {
          lines.push(`${pc.yellow('💡')} ${result.error.suggestion}`)
        }
      } else if (result.severity === 'warning') {
        // 命令成功但状态需注意（如 verify 发现未 patch）：黄色而非绿色，避免"验证通过"的视觉误导
        lines.push(`${pc.yellow('[WARN]')} ${result.summary}`)
      } else {
        lines.push(`${pc.green('[OK]')} ${result.summary}`)
      }

      if (result.warnings && result.warnings.length > 0) {
        lines.push('')
        lines.push(pc.yellow(t('ui.warnings')))
        for (const warning of result.warnings) {
          lines.push(`  ${warning}`)
        }
      }

      if (result.next && result.next.length > 0) {
        lines.push('')
        lines.push(t('ui.nextSteps'))
        for (let i = 0; i < result.next.length; i++) {
          lines.push(`  ${i + 1}. ${result.next[i]}`)
        }
      }

      // 为人类可读模式补充列表类数据
      if (result.data && Array.isArray((result.data as Record<string, unknown>).versions)) {
        const versions = ((result.data as Record<string, unknown>).versions as Array<Record<string, unknown>>)
        if (versions.length > 0) {
          lines.push('')
          for (const item of versions) {
            const version = String(item.version ?? '')
            const current = item.current ? ' ← current' : ''
            const platforms = Array.isArray(item.platforms)
              ? ` (${item.platforms.join(', ')})`
              : ''
            const installed = item.installed === true ? ' [installed]' : ''
            const patched = item.patched === true ? ' [patched]' : ''
            const targets = Array.isArray(item.targets)
              ? ` → ${item.targets.join(', ')}`
              : ''
            lines.push(`  ${version}${platforms}${installed}${patched}${targets}${current}`)
          }
        }
      }

      return lines.join('\n')
    },
  }
}
