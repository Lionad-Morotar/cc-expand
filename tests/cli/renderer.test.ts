/**
 * 渲染层测试
 */
import { describe, it, expect } from 'vitest'
import { createRenderer } from '../../src/cli/renderer.js'

describe('renderer', () => {
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
})
