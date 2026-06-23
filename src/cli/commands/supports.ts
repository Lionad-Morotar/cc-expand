/**
 * supports command — 列出所有支持的 Claude Code 版本及其平台覆盖情况
 */

import { ConfigService } from '../../services/config.js'
import { DiscoveryService } from '../../services/discovery.js'
import { ChannelConfig, type ChannelConfigData } from '../../services/channel-config.js'
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

export interface SupportsOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
  /** channel.json 读取器（测试注入；默认读 ~/.cc-expand/channel.json） */
  channelConfig?: ChannelConfig
}

export async function supportsCommand(
  _args: string[] = [],
  options?: SupportsOptions,
): Promise<CommandResult<SupportsData>> {
  const config = options?.configService ?? new ConfigService()
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const channelConfig = options?.channelConfig ?? new ChannelConfig()
  const index = await config.getVersionIndex()

  // 解析当前激活版本：channel.json（migration/setup 选定）优先于 PATH 探测。
  // Why 不能只用 discovery.findClaudeBinary：PATH 上的 claude 可能是旧的系统安装
  // （如 homebrew），与用户通过 ccx channel 实际激活的版本脱节，曾导致 current 标记
  // 指向 homebrew 的 2.1.161 而非激活的 2.1.186。与 status/patch/setup 的版本源对齐，见 ADR 0001。
  let currentVersion: string | undefined
  let channel: ChannelConfigData | undefined
  try {
    channel = channelConfig.getChannel()
  } catch {
    // channel.json 损坏（手编/写入中断）：视作无 channel，回退 PATH 探测
    channel = undefined
  }
  if (channel?.version) {
    currentVersion = channel.version
  } else {
    try {
      const binaryPath = await discovery.findClaudeBinary()
      const v = await discovery.getBinaryVersion(binaryPath)
      currentVersion = v === 'unknown' ? undefined : v
    } catch {
      // 无 channel 且 PATH/NPX 也无 claude：不显示 current 高亮
    }
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
