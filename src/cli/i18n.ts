/**
 * 国际化（i18n）模块
 * 命令级翻译键，默认 locale 为 en
 */
export type Locale = 'en' | 'zh'

export type I18nKey =
  | 'command.config.get'
  | 'command.config.set'
  | 'command.config.lang'
  | 'command.status.noBinary'
  | 'command.status.patched'
  | 'command.status.unpatched'
  | 'command.supports.summary'
  | 'command.supports.unsupportedCurrent'
  | 'command.install.success'
  | 'command.install.alreadyInstalled'
  | 'command.setup.success'
  | 'command.restore.success'
  | 'command.restore.shortcutsStillPoint'
  | 'command.verify.patched'
  | 'command.verify.unpatched'
  | 'command.patch.success'
  | 'command.list.summary'
  | 'error.invalidTarget'
  | 'error.unknownKey'
  | 'error.missingValue'
  | 'error.missingArgument'

type Translations = Record<Locale, Record<I18nKey, string>>

const translations: Translations = {
  en: {
    'command.config.get': 'Configuration value for {key}: {value}',
    'command.config.set': 'Set {key} to {value}',
    'command.config.lang': 'Locale set to {value}',
    'command.status.noBinary': 'Claude Code is not installed on this system',
    'command.status.patched': 'Claude Code {version} is patched to {targets} tokens',
    'command.status.unpatched': 'Claude Code {version} is using the default context window',
    'command.supports.summary': '{count} supported Claude Code versions',
    'command.supports.unsupportedCurrent': 'Claude Code {version} on {platform} is not in the supported list',
    'command.install.success': 'Claude Code {version} installed successfully',
    'command.install.alreadyInstalled': 'Claude Code {version} is already installed',
    'command.setup.success': 'Shell shortcuts installed',
    'command.restore.success': 'Restored Claude Code to original binary',
    'command.restore.shortcutsStillPoint': 'Shell shortcuts c / cc still point to the patched binary',
    'command.verify.patched': 'Claude Code {version} is fully patched',
    'command.verify.unpatched': 'Claude Code {version} is unpatched ({count} original constants found)',
    'command.patch.success': 'Patched Claude Code {version} to {targetTokens} tokens',
    'command.list.summary': '{count} versions listed',
    'error.invalidTarget': 'Invalid value: {value}',
    'error.unknownKey': 'Unknown configuration key: {key}',
    'error.missingValue': '{flag} requires a value',
    'error.missingArgument': 'Missing required argument: {name}',
  },
  zh: {
    'command.config.get': '{key} 的当前值为 {value}',
    'command.config.set': '已将 {key} 设置为 {value}',
    'command.config.lang': '语言已设置为 {value}',
    'command.status.noBinary': '当前系统未安装 Claude Code',
    'command.status.patched': 'Claude Code {version} 已 patch 到 {targets} tokens',
    'command.status.unpatched': 'Claude Code {version} 使用默认上下文窗口',
    'command.supports.summary': '{count} 个支持的 Claude Code 版本',
    'command.supports.unsupportedCurrent': 'Claude Code {version}（{platform}）不在支持列表中',
    'command.install.success': 'Claude Code {version} 安装成功',
    'command.install.alreadyInstalled': 'Claude Code {version} 已安装',
    'command.setup.success': 'Shell 快捷方式已安装',
    'command.restore.success': '已恢复 Claude Code 原始 binary',
    'command.restore.shortcutsStillPoint': 'Shell 快捷方式 c / cc 仍然指向 patch 版本',
    'command.verify.patched': 'Claude Code {version} 已完成 patch',
    'command.verify.unpatched': 'Claude Code {version} 未 patch（发现 {count} 处原始常量）',
    'command.patch.success': '已将 Claude Code {version} patch 到 {targetTokens} tokens',
    'command.list.summary': '{count} 个版本',
    'error.invalidTarget': '无效的值：{value}',
    'error.unknownKey': '未知配置项：{key}',
    'error.missingValue': '{flag} 需要一个值',
    'error.missingArgument': '缺少必要参数：{name}',
  },
}

let currentLocale: Locale = 'en'

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: I18nKey, params?: Record<string, string | number | boolean>): string {
  let template = translations[currentLocale][key]
  if (!template) {
    template = translations.en[key] ?? key
  }

  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}
