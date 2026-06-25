/**
 * 国际化（i18n）模块
 * 命令级翻译键，默认 locale 为 en
 */
export type Locale = 'en' | 'zh'

export type I18nKey
  = | 'command.config.get'
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
    | 'command.patch.remove.success'
    | 'command.patch.remove.all'
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
    | 'error.selfUpdate.prereleaseChannelUnknown'
    | 'suggestion.selfUpdate.prereleaseChannelUnknown'
    | 'suggestion.selfUpdate.unknownMethod'
    | 'suggestion.selfUpdate.eacces'
    | 'suggestion.selfUpdate.enoent'
    | 'warning.selfUpdate.stalled'
    | 'warning.selfUpdate.registryHint'
    | 'ui.warnings'
    | 'ui.nextSteps'
    | 'ui.pagerFooter'
    | 'update.hint.available'
    // help section titles
    | 'help.section.usage'
    | 'help.section.options'
    | 'help.section.commands'
    | 'help.section.examples'
    | 'help.section.moreInfo'
    // global option descriptions
    | 'help.global.option.noColor'
    | 'help.global.option.quiet'
    | 'help.global.option.json'
    | 'help.global.option.locale'
    | 'help.global.option.help'
    | 'help.global.option.version'
    // command descriptions
    | 'help.command.config.description'
    | 'help.command.status.description'
    | 'help.command.supports.description'
    | 'help.command.install.description'
    | 'help.command.setup.description'
    | 'help.command.restore.description'
    | 'help.command.verify.description'
    | 'help.command.run.description'
    | 'help.command.patch.description'
    | 'help.command.migration.description'
    | 'help.command.list.description'
    | 'help.command.selfUpdate.description'
    | 'help.command.plugins.description'
    // command option descriptions
    | 'help.command.supports.option.all'
    | 'help.command.setup.option.yes'
    | 'help.command.patch.option.target'
    | 'help.command.patch.option.yes'
    | 'help.command.migration.option.from'
    | 'help.command.migration.option.yes'
    | 'help.command.migration.option.dryRun'
    | 'help.command.list.option.patched'
    | 'help.command.list.option.all'

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
    'command.patch.remove.success': "Removed combo '{combo}' from version {version}",
    'command.patch.remove.all': 'Removed {count} combo(s) from version {version}',
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
    'error.selfUpdate.prereleaseChannelUnknown': 'Cannot determine the latest {channel} version (npm query failed). Refusing to auto-update to avoid downgrading to stable.',
    'suggestion.selfUpdate.prereleaseChannelUnknown': 'Update manually: npm install -g cc-expand@{channel}',
    'suggestion.selfUpdate.unknownMethod': 'Declare explicitly via `ccx config set installMethod <npm|pnpm|yarn>`',
    'suggestion.selfUpdate.eacces': 'Configure npm prefix to a user directory (npm config set prefix ~/.npm-global), or use sudo (not recommended)',
    'suggestion.selfUpdate.enoent': 'Ensure the package manager is installed and in PATH',
    'warning.selfUpdate.stalled': 'The installed version is still {actual} while the latest is {latest}. Your npm registry mirror may lag behind the official registry.',
    'warning.selfUpdate.registryHint': 'Retry against the official registry to bypass mirror lag, e.g. npm install -g cc-expand@latest --registry=https://registry.npmjs.org',
    'ui.warnings': '⚠ Warnings:',
    'ui.nextSteps': 'Next steps:',
    'ui.pagerFooter': 'line {line}/{total}  ↑↓/jk move  Space/b page  g/G top/bottom  Ctrl-E bottom  q quit',
    'update.hint.available': 'Update available: {current} → {latest}. Run `ccx self-update` to update.',
    // help section titles
    'help.section.usage': 'Usage',
    'help.section.options': 'Options',
    'help.section.commands': 'Commands',
    'help.section.examples': 'Examples',
    'help.section.moreInfo': 'For more info, run any command with the `--help` flag',
    // global option descriptions
    'help.global.option.noColor': 'Disable ANSI colors',
    'help.global.option.quiet': 'Suppress non-error output',
    'help.global.option.json': 'Output structured JSON',
    'help.global.option.locale': 'Set locale for this command (en or zh)',
    'help.global.option.help': 'Display this message',
    'help.global.option.version': 'Display version number',
    // command descriptions
    'help.command.config.description': 'Manage user preferences',
    'help.command.status.description': 'Show current patch status',
    'help.command.supports.description': 'List supported Claude Code versions',
    'help.command.install.description': 'Download Claude Code via npm',
    'help.command.setup.description': 'Install shell shortcuts (cc, c)',
    'help.command.restore.description': 'Restore original binary',
    'help.command.verify.description': 'Check patch status',
    'help.command.run.description': 'Launch patched Claude Code',
    'help.command.patch.description': 'Patch or unpatch local Claude Code binary',
    'help.command.migration.description': 'Migrate existing patches to a target version',
    'help.command.list.description': 'List installed and patched versions',
    'help.command.selfUpdate.description': 'Update cc-expand to the latest npm version',
    'help.command.plugins.description': 'Manage plugins',
    // command option descriptions
    'help.command.supports.option.all': 'Show full list without pager',
    'help.command.setup.option.yes': 'Skip confirmation',
    'help.command.patch.option.target': 'Target context window size (e.g. 270000 or 27w)',
    'help.command.patch.option.yes': 'Skip confirmation',
    'help.command.migration.option.from': 'Source version to migrate from',
    'help.command.migration.option.yes': 'Skip confirmation',
    'help.command.migration.option.dryRun': 'Preview without applying',
    'help.command.list.option.patched': 'Show only patched versions',
    'help.command.list.option.all': 'Show full list without pager'
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
    'command.patch.remove.success': "已从版本 {version} 移除 combo '{combo}'",
    'command.patch.remove.all': '已从版本 {version} 移除 {count} 个 combo',
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
    'error.selfUpdate.prereleaseChannelUnknown': '无法确定 {channel} 通道的最新版本（npm 查询失败）。为避免降级到 stable，已中止自动更新。',
    'suggestion.selfUpdate.prereleaseChannelUnknown': '请手动更新：npm install -g cc-expand@{channel}',
    'suggestion.selfUpdate.unknownMethod': '请用 `ccx config set installMethod <npm|pnpm|yarn>` 显式声明',
    'suggestion.selfUpdate.eacces': '建议配置 npm prefix 到用户目录（npm config set prefix ~/.npm-global），或用 sudo（不推荐，可能破坏权限）',
    'suggestion.selfUpdate.enoent': '请确认对应的包管理器已安装并在 PATH 中',
    'warning.selfUpdate.stalled': '已安装版本仍为 {actual}，而最新版本是 {latest}。你的 npm 镜像源可能尚未同步官方仓库。',
    'warning.selfUpdate.registryHint': '可指定官方源绕过镜像延迟，例如 npm install -g cc-expand@latest --registry=https://registry.npmjs.org',
    'ui.warnings': '⚠ 注意：',
    'ui.nextSteps': '建议操作：',
    'ui.pagerFooter': 'line {line}/{total}  ↑↓/jk 移动  Space/b 翻页  g/G 首尾  Ctrl-E 末行  q 退出',
    'update.hint.available': '发现新版本：{current} → {latest}。运行 `ccx self-update` 更新。',
    // help section titles
    'help.section.usage': '用法',
    'help.section.options': '选项',
    'help.section.commands': '命令',
    'help.section.examples': '示例',
    'help.section.moreInfo': '更多信息请运行任意命令的 `--help` 参数',
    // global option descriptions
    'help.global.option.noColor': '关闭 ANSI 颜色',
    'help.global.option.quiet': '只显示错误输出',
    'help.global.option.json': '输出结构化 JSON',
    'help.global.option.locale': '设置本次命令的语言（en 或 zh）',
    'help.global.option.help': '显示此帮助信息',
    'help.global.option.version': '显示版本号',
    // command descriptions
    'help.command.config.description': '管理用户偏好设置',
    'help.command.status.description': '显示当前 patch 状态',
    'help.command.supports.description': '列出支持的 Claude Code 版本',
    'help.command.install.description': '通过 npm 下载 Claude Code',
    'help.command.setup.description': '安装 shell 快捷方式（cc、c）',
    'help.command.restore.description': '恢复原始 binary',
    'help.command.verify.description': '检查 patch 状态',
    'help.command.run.description': '启动已 patch 的 Claude Code',
    'help.command.patch.description': 'Patch 或取消 patch 本地 Claude Code binary',
    'help.command.migration.description': '将现有 patch 迁移到目标版本',
    'help.command.list.description': '列出已安装和已 patch 的版本',
    'help.command.selfUpdate.description': '将 cc-expand 更新到最新 npm 版本',
    'help.command.plugins.description': '管理插件',
    // command option descriptions
    'help.command.supports.option.all': '不使用分页显示完整列表',
    'help.command.setup.option.yes': '跳过确认',
    'help.command.patch.option.target': '目标上下文窗口大小（例如 270000 或 27w）',
    'help.command.patch.option.yes': '跳过确认',
    'help.command.migration.option.from': '要迁移的源版本',
    'help.command.migration.option.yes': '跳过确认',
    'help.command.migration.option.dryRun': '预览而不应用',
    'help.command.list.option.patched': '只显示已 patch 的版本',
    'help.command.list.option.all': '不使用分页显示完整列表'
  }
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
  fallback: Locale = 'en'
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
  const template = localeMap[key] ?? translations.en[key] ?? key

  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}
