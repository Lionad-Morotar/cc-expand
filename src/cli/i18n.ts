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
  | 'command.migration.success'
  | 'command.migration.dryRun'
  | 'command.migration.alreadyAtVersion'
  | 'command.list.summary'
  | 'command.selfUpdate.npxHint'
  | 'command.selfUpdate.success'
  | 'command.selfUpdate.alreadyLatest'
  | 'command.selfUpdate.updated'
  | 'command.selfUpdate.stalledSummary'
  | 'error.invalidTarget'
  | 'error.unknownKey'
  | 'error.missingValue'
  | 'error.missingArgument'
  | 'error.selfUpdate.unknownMethod'
  | 'error.selfUpdate.exitCode'
  | 'error.selfUpdate.eacces'
  | 'error.selfUpdate.enoent'
  | 'error.selfUpdate.generic'
  | 'suggestion.selfUpdate.unknownMethod'
  | 'suggestion.selfUpdate.eacces'
  | 'suggestion.selfUpdate.enoent'
  | 'warning.selfUpdate.stalled'
  | 'warning.selfUpdate.registryHint'
  | 'ui.warnings'
  | 'ui.nextSteps'
  | 'update.hint.available'

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
    'command.migration.success': 'Migrated {count} target(s) from {from} to {to}',
    'command.migration.dryRun': 'Would migrate {count} target(s) from {from} to {to} (preview, not applied)',
    'command.migration.alreadyAtVersion': 'Already at version {version}, nothing to migrate',
    'command.list.summary': '{count} versions listed',
    'command.selfUpdate.npxHint': 'npx always uses the latest version, no self-update needed',
    'command.selfUpdate.success': 'Updated to the latest version. Restart `ccx` to take effect.',
    'command.selfUpdate.alreadyLatest': 'Already up to date ({version}).',
    'command.selfUpdate.updated': 'Updated from {from} to {to}. Restart `ccx` to take effect.',
    'command.selfUpdate.stalledSummary': 'Install command ran, but cc-expand is still {actual}',
    'error.invalidTarget': 'Invalid value: {value}',
    'error.unknownKey': 'Unknown configuration key: {key}',
    'error.missingValue': '{flag} requires a value',
    'error.missingArgument': 'Missing required argument: {name}',
    'error.selfUpdate.unknownMethod': 'Cannot auto-detect how cc-expand was installed',
    'error.selfUpdate.exitCode': 'Update failed, package manager exited with code {code}',
    'error.selfUpdate.eacces': 'Permission denied, cannot write to global install directory',
    'error.selfUpdate.enoent': 'Command not found: {message}',
    'error.selfUpdate.generic': 'Update failed: {message}',
    'suggestion.selfUpdate.unknownMethod': 'Declare explicitly via `ccx config set installMethod <npm|pnpm|yarn>`',
    'suggestion.selfUpdate.eacces': 'Configure npm prefix to a user directory (npm config set prefix ~/.npm-global), or use sudo (not recommended)',
    'suggestion.selfUpdate.enoent': 'Ensure the package manager is installed and in PATH',
    'warning.selfUpdate.stalled': 'The installed version is still {actual} while the latest is {latest}. Your npm registry mirror may lag behind the official registry.',
    'warning.selfUpdate.registryHint': 'Retry against the official registry to bypass mirror lag, e.g. npm install -g cc-expand@latest --registry=https://registry.npmjs.org',
    'ui.warnings': '⚠ Warnings:',
    'ui.nextSteps': 'Next steps:',
    'update.hint.available': 'Update available: {current} → {latest}. Run `ccx self-update` to update.',
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
    'command.migration.success': '已将 {count} 个 target 从 {from} 迁移到 {to}',
    'command.migration.dryRun': '将把 {count} 个 target 从 {from} 迁移到 {to}（预览，未执行）',
    'command.migration.alreadyAtVersion': '已是版本 {version}，无需迁移',
    'command.list.summary': '{count} 个版本',
    'command.selfUpdate.npxHint': 'npx 每次自动拉取最新版，无需 self-update',
    'command.selfUpdate.success': '已更新到最新版，下次运行 ccx 即生效',
    'command.selfUpdate.alreadyLatest': '已是最新版本（{version}）。',
    'command.selfUpdate.updated': '已从 {from} 更新到 {to}。下次运行 ccx 即生效。',
    'command.selfUpdate.stalledSummary': '安装命令已执行，但 cc-expand 仍为 {actual}',
    'error.invalidTarget': '无效的值：{value}',
    'error.unknownKey': '未知配置项：{key}',
    'error.missingValue': '{flag} 需要一个值',
    'error.missingArgument': '缺少必要参数：{name}',
    'error.selfUpdate.unknownMethod': '无法自动检测 cc-expand 的安装方式',
    'error.selfUpdate.exitCode': '更新失败，包管理器退出码 {code}',
    'error.selfUpdate.eacces': '权限不足，无法写入全局安装目录',
    'error.selfUpdate.enoent': '未找到命令：{message}',
    'error.selfUpdate.generic': '更新失败：{message}',
    'suggestion.selfUpdate.unknownMethod': '请用 `ccx config set installMethod <npm|pnpm|yarn>` 显式声明',
    'suggestion.selfUpdate.eacces': '建议配置 npm prefix 到用户目录（npm config set prefix ~/.npm-global），或用 sudo（不推荐，可能破坏权限）',
    'suggestion.selfUpdate.enoent': '请确认对应的包管理器已安装并在 PATH 中',
    'warning.selfUpdate.stalled': '已安装版本仍为 {actual}，而最新版本是 {latest}。你的 npm 镜像源可能尚未同步官方仓库。',
    'warning.selfUpdate.registryHint': '可指定官方源绕过镜像延迟，例如 npm install -g cc-expand@latest --registry=https://registry.npmjs.org',
    'ui.warnings': '⚠ 注意：',
    'ui.nextSteps': '建议操作：',
    'update.hint.available': '发现新版本：{current} → {latest}。运行 `ccx self-update` 更新。',
  },
}

const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh']

let currentLocale: Locale = 'en'

/** 判断字符串是否为受支持的 locale 值 */
export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * 把任意输入归一化为合法 locale
 * 非法或空值回退到 fallback（默认 en），避免 t() 因越界 locale 崩溃
 */
export function normalizeLocale(
  value: string | undefined | null,
  fallback: Locale = 'en',
): Locale {
  return value != null && isLocale(value) ? value : fallback
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: I18nKey, params?: Record<string, string | number | boolean>): string {
  // 防御：currentLocale 若被设为非法值，回退到 en 表，避免 translations[bad][key] 崩溃
  const localeMap = translations[currentLocale] ?? translations.en
  let template = localeMap[key] ?? translations.en[key] ?? key

  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}
