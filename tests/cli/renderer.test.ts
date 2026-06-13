/**
 * 渲染层测试
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRenderer } from '../../src/cli/renderer.js'
import { setLocale } from '../../src/cli/i18n.js'

describe('renderer', () => {
  afterEach(() => {
    // renderer.render 会同步全局 locale，恢复默认避免影响其他测试
    setLocale('en')
  })

  it('renders success as human-readable text by default', () => {
    const renderer = createRenderer()
    const result = {
      success: true,
      command: 'config',
      summary: 'Locale is en',
      data: { key: 'locale', value: 'en' },
    }

    const output = renderer.render(result, 'config')
    expect(output).toContain('[OK]')
    expect(output).toContain('Locale is en')
  })

  it('renders JSON envelope when json mode is enabled', () => {
    const renderer = createRenderer({ json: true, locale: 'en' })
    const result = {
      success: true,
      command: 'config',
      summary: 'Locale is en',
      data: { key: 'locale', value: 'en' },
    }

    const output = renderer.render(result, 'config')
    const parsed = JSON.parse(output!)
    expect(parsed.success).toBe(true)
    expect(parsed.command).toBe('config')
    expect(parsed.data).toEqual({ key: 'locale', value: 'en' })
    expect(parsed.locale).toBe('en')
  })

  it('suppresses success output in quiet mode', () => {
    const renderer = createRenderer({ quiet: true })
    const result = {
      success: true,
      command: 'config',
      summary: 'Locale is en',
    }

    expect(renderer.render(result, 'config')).toBeUndefined()
  })

  it('still renders errors in quiet mode', () => {
    const renderer = createRenderer({ quiet: true })
    const result = {
      success: false,
      command: 'config',
      summary: 'Bad input',
      error: { code: 'INVALID_TARGET', message: 'Bad input' },
    }

    const output = renderer.render(result, 'config')
    expect(output).toContain('[ERROR]')
    expect(output).toContain('Bad input')
  })

  it('omits ANSI codes when color is disabled', () => {
    const renderer = createRenderer({ color: false })
    const result = {
      success: true,
      command: 'config',
      summary: 'Locale is en',
    }

    const output = renderer.render(result, 'config')
    expect(output).not.toContain('\x1b[')
  })

  it('renders warning and next-step labels in zh locale', () => {
    const renderer = createRenderer({ locale: 'zh' })
    const result = {
      success: true,
      command: 'restore',
      summary: 'ok',
      warnings: ['shortcut still points to patched'],
      next: ['edit profile'],
    }

    const output = renderer.render(result, 'restore')
    expect(output).toContain('注意')
    expect(output).toContain('建议操作')
  })

  it('renders warning and next-step labels in en locale', () => {
    const renderer = createRenderer({ locale: 'en' })
    const result = {
      success: true,
      command: 'restore',
      summary: 'ok',
      warnings: ['shortcut still points to patched'],
      next: ['edit profile'],
    }

    const output = renderer.render(result, 'restore')
    expect(output).toContain('Warnings')
    expect(output).toContain('Next steps')
  })

  it('renders warning severity as yellow [WARN] instead of green [OK]', () => {
    const renderer = createRenderer()
    const result = {
      success: true,
      command: 'verify',
      summary: 'Claude Code 2.1.170 is unpatched',
      severity: 'warning' as const,
    }

    const output = renderer.render(result, 'verify')
    expect(output).toContain('[WARN]')
    expect(output).not.toContain('[OK]')
    expect(output).toContain('unpatched')
  })
})
