/**
 * cc-expand status — 显示当前 patch 状态
 */
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { formatSummary, highlight } from '../output.js'

export interface StatusOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
  homeDir?: string
}

export async function statusCommand(options?: StatusOptions): Promise<string> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const configService = options?.configService ?? new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  const userConfig = configService.getUserConfig()
  const patchedInfo = userConfig.patchedVersions[version]

  const shortcutState = readShortcutState(options?.homeDir)

  // 构建第一行摘要
  let summary: string
  if (patchedInfo) {
    const targets = patchedInfo.targets.join(', ')
    summary = `Claude Code ${highlight(version)} — 已 patch 到 ${highlight(targets)} tokens`
  } else {
    summary = `Claude Code ${highlight(version)} — 未 patch（默认上下文窗口）`
  }

  const lines: string[] = [
    formatSummary('INFO', summary),
    '',
    `Binary: ${highlight(binaryPath)}`,
  ]

  if (patchedInfo) {
    const patchedAt = new Date(patchedInfo.patchedAt).toLocaleString('zh-CN')
    lines.push(`Patch 时间: ${patchedAt}`)
  }

  // 快捷方式状态
  if (shortcutState.ccTarget || shortcutState.cTarget) {
    lines.push('')
    lines.push('快捷方式状态:')
    if (shortcutState.ccTarget) {
      lines.push(`  cc() → ${highlight(shortcutState.ccTarget)}`)
    }
    if (shortcutState.cTarget) {
      lines.push(`  c alias → ${highlight(shortcutState.cTarget)}`)
    }
  }

  // 已安装 patch 版本
  const allPatched = Object.entries(userConfig.patchedVersions)
  if (allPatched.length > 0) {
    lines.push('')
    lines.push('已安装 patch 版本:')
    for (const [v, info] of allPatched) {
      const targets = info.targets.map((t) => highlight(String(t))).join(', ')
      const marker = v === version ? ' ← 当前' : ''
      lines.push(`  ${v}: ${targets} tokens${marker}`)
    }
  }

  return lines.join('\n')
}
