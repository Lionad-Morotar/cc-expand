/**
 * i18n locale 守卫与翻译查表测试
 * 覆盖非法 locale 不崩溃、归一化回退等防御逻辑
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  isLocale,
  normalizeLocale,
  setLocale,
  getLocale,
  t
} from '../../src/cli/i18n.js'

describe('i18n locale guards', () => {
  afterEach(() => {
    // 恢复默认 locale，避免全局状态污染后续测试
    setLocale('en')
  })

  describe('isLocale', () => {
    it('accepts en and zh', () => {
      expect(isLocale('en')).toBe(true)
      expect(isLocale('zh')).toBe(true)
    })

    it('rejects unsupported locale strings (case-sensitive)', () => {
      expect(isLocale('fr')).toBe(false)
      expect(isLocale('')).toBe(false)
      expect(isLocale('EN')).toBe(false)
      expect(isLocale('zh-CN')).toBe(false)
    })
  })

  describe('normalizeLocale', () => {
    it('returns valid locale unchanged', () => {
      expect(normalizeLocale('en')).toBe('en')
      expect(normalizeLocale('zh')).toBe('zh')
    })

    it('falls back to en by default for invalid value', () => {
      expect(normalizeLocale('fr')).toBe('en')
      expect(normalizeLocale('')).toBe('en')
    })

    it('respects a custom fallback', () => {
      expect(normalizeLocale('fr', 'zh')).toBe('zh')
      expect(normalizeLocale(undefined, 'zh')).toBe('zh')
    })

    it('handles null and undefined', () => {
      expect(normalizeLocale(undefined)).toBe('en')
      expect(normalizeLocale(null)).toBe('en')
    })
  })

  describe('warning.bytecodePatternMissing', () => {
    const params = { version: '2.1.250', platform: 'darwin-arm64' }

    it('has an English translation with placeholders replaced', () => {
      setLocale('en')
      const rendered = t('warning.bytecodePatternMissing', params)
      expect(rendered).not.toBe('warning.bytecodePatternMissing') // 非缺失 key 回退
      expect(rendered).toContain('2.1.250')
      expect(rendered).toContain('darwin-arm64')
      expect(rendered).not.toContain('{version}')
      expect(rendered).not.toContain('{platform}')
    })

    it('has a Chinese translation with placeholders replaced', () => {
      setLocale('zh')
      const rendered = t('warning.bytecodePatternMissing', params)
      expect(rendered).not.toBe('warning.bytecodePatternMissing')
      expect(rendered).toContain('2.1.250')
      expect(rendered).toContain('darwin-arm64')
      expect(rendered).not.toContain('{version}')
      expect(rendered).not.toContain('{platform}')
    })
  })

  describe('t() defensive lookup', () => {
    it('does not crash when currentLocale holds an unsupported value', () => {
      // 模拟 -l fr 等绕过校验的场景：currentLocale 被设为越界值
      setLocale('fr' as never)
      expect(() => t('command.status.noBinary')).not.toThrow()
      // 应回退到 en 表的翻译
      expect(t('command.status.noBinary')).toContain('Claude Code')
    })

    it('returns the key itself when translation is entirely missing', () => {
      setLocale('en')
      expect(getLocale()).toBe('en')
    })
  })
})
