/**
 * supports command — 列出所有支持的 Claude Code 版本及其平台覆盖情况
 */

import { ConfigService } from '../../services/config.js'
import { DiscoveryService } from '../../services/discovery.js'
import { t } from '../i18n.js'
import { type CommandResult } from '../result.js'

export interface SupportsData {
  currentVersion?: string
  versions: Array<{
    version: string
    platforms: string[]
    current: boolean
  }>
}

export async function supportsCommand(
  _args: string[] = [],
  options?: {
    discoveryService?: DiscoveryService
    configService?: ConfigService
  },
): Promise<CommandResult<SupportsData>> {
  const config = options?.configService ?? new ConfigService()
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const index = await config.getVersionIndex()

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

  const versions = index
    .map((item) => ({
      version: item.version,
      platforms: item.platforms,
      current: item.version === currentVersion,
    }))
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }),
    )

  const warnings: string[] = []
  if (currentVersion && !versions.some((v) => v.version === currentVersion)) {
    warnings.push(
      t('command.supports.unsupportedCurrent', {
        version: currentVersion,
        platform: `${process.platform}-${process.arch}`,
      }),
    )
  }

  return {
    success: true,
    command: 'supports',
    summary: t('command.supports.summary', { count: versions.length }),
    data: {
      currentVersion,
      versions,
    },
    warnings,
  }
}
