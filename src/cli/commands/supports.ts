/**
 * supports command — 列出所有支持的 Claude Code 版本及其平台覆盖情况
 */

import { ConfigService } from '../../services/config.js'
import { DiscoveryService } from '../../services/discovery.js'
import { formatSummary, highlight, formatWarnings } from '../output.js'

export async function supportsCommand(
  _args: string[] = [],
  options?: {
    discoveryService?: DiscoveryService
    configService?: ConfigService
  },
): Promise<string> {
  const config = options?.configService ?? new ConfigService()
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const patterns = config.getPatterns()

  // 尝试获取当前系统 Claude Code 版本
  let currentVersion: string | undefined
  try {
    const binaryPath = await discovery.findClaudeBinary()
    currentVersion = await discovery.getBinaryVersion(binaryPath)
    if (currentVersion === 'unknown') {
      currentVersion = undefined
    }
  } catch {
    // 未安装 Claude Code，不显示高亮
  }

  const versions = Object.keys(patterns).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )

  const lines: string[] = [
    formatSummary('INFO', `支持的 Claude Code 版本 (${versions.length} 个)`),
    '',
  ]

  for (const version of versions) {
    const versionConfig = patterns[version]
    const platforms: string[] = []

    for (const [os, archMap] of Object.entries(versionConfig.platforms)) {
      for (const arch of Object.keys(archMap)) {
        platforms.push(`${os}-${arch}`)
      }
    }

    const isCurrent = currentVersion === version
    const versionText = isCurrent ? highlight(version) : version
    const suffix = isCurrent ? '  ← 当前版本' : ''
    lines.push(`  ${versionText} (${platforms.join(', ')})${suffix}`)
  }

  // 如果当前版本不在支持列表中，添加警告
  if (currentVersion && !patterns[currentVersion]) {
    const currentPlatform = `${process.platform}-${process.arch}`
    lines.push(formatWarnings([
      `当前 Claude Code ${highlight(currentVersion)} 在 ${currentPlatform} 上不受支持`,
    ]))
  }

  return lines.join('\n')
}
