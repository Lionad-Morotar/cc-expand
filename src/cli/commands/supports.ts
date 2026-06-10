/**
 * supports command — 列出所有支持的 Claude Code 版本及其平台覆盖情况
 */

import { ConfigService } from '../../services/config.js'
import { DiscoveryService } from '../../services/discovery.js'

export async function supportsCommand(
  _args: string[] = [],
  options?: {
    discoveryService?: DiscoveryService
    configService?: ConfigService
  },
): Promise<void> {
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

  console.log('Supported versions:')

  const versions = Object.keys(patterns).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )

  for (const version of versions) {
    const versionConfig = patterns[version]
    const platforms: string[] = []

    for (const [os, archMap] of Object.entries(versionConfig.platforms)) {
      for (const arch of Object.keys(archMap)) {
        platforms.push(`${os}-${arch}`)
      }
    }

    const isCurrent = currentVersion === version
    const suffix = isCurrent ? '  ← current' : ''
    console.log(`  ${version} (${platforms.join(', ')})${suffix}`)
  }

  // 如果当前版本不在支持列表中，输出警告
  if (currentVersion && !patterns[currentVersion]) {
    const currentPlatform = `${process.platform}-${process.arch}`
    console.error(
      `⚠️  Current Claude Code ${currentVersion} is NOT supported on ${currentPlatform}`,
    )
  }
}
