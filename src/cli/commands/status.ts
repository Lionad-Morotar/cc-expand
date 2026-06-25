/**
 * cc-expand status — 显示当前 patch 状态
 * 当检测到 npm 有新版本且当前版本已 patch 时，在 next 步骤建议 migration，
 * 引导用户走更短的升级路径。latest 查询用 queryLatestVersion（execFile timeout 自动 kill），
 * 失败/超时静默返回 undefined，绝不破坏主输出或阻塞进程退出。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { ChannelConfig, type ChannelConfigData } from '../../services/channel-config.js'
import { queryLatestVersion } from '../../services/latest-checker.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { isVersionGreater } from '../../utils/version.js'
import { formatTokenCount } from '@cc-expand/plugin-context-expand'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export interface StatusOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
  homeDir?: string
  /** 解析 latest 版本（注入以避免网络）；缺省用 queryLatestVersion */
  latestResolver?: (v: string) => Promise<string | undefined>
}

export interface StatusData {
  version?: string
  binaryPath?: string
  /** version 来源：channel（channel.json 激活版本）或 system（PATH 原生 claude） */
  activeSource?: 'channel' | 'system'
  patched: boolean
  targets?: number[]
  combos?: string[]
  patchedAt?: string
  shortcuts?: {
    ccTarget?: string
    cTarget?: string
    pointsToPatched: boolean
  }
  installedVersions: Array<{
    version: string
    targets?: number[]
    patchedAt: string
    current: boolean
  }>
}

/** 当前版本已 patch、npm latest 更新、且 latest 尚未 patch 时，建议 migration；否则无 next */
async function buildMigrationHint(
  options: StatusOptions | undefined,
  patchedInfo: { targets?: number[], patchedAt: string } | undefined,
  currentVersion: string,
  patchedVersions: Record<string, { targets?: number[], patchedAt: string }>
): Promise<string[] | undefined> {
  if (!patchedInfo) return undefined
  const resolver = options?.latestResolver ?? (() => queryLatestVersion())
  let latest: string | undefined
  try {
    latest = await resolver('latest')
  } catch {
    // resolver 失败（网络/超时）静默跳过，绝不破坏 status 主输出
    latest = undefined
  }
  // 仅当 latest 新于当前版本 且 latest 尚未 patch——否则说明已迁移过，不再重复建议
  if (latest && isVersionGreater(latest, currentVersion) && !patchedVersions[latest]) {
    return ['ccx migration latest']
  }
  return undefined
}

export async function statusCommand(options?: StatusOptions): Promise<CommandResult<StatusData>> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const configService = options?.configService ?? new ConfigService()
  const homeDir = options?.homeDir ?? homedir()

  let binaryPath: string | undefined
  let version: string | undefined
  // Active Version（channel.json）优先于 System Version（PATH 探测），与 patch/setup 的版本源对齐
  let activeSource: 'channel' | 'system'

  // channel.json 损坏（手编/写入被中断）时 getChannel 内的 JSON.parse 会抛 SyntaxError——
  // 隔离它：损坏即视作无 channel，回退 PATH 探测，绝不让 status 崩溃
  let channel: ChannelConfigData | undefined
  try {
    channel = new ChannelConfig(join(homeDir, '.cc-expand')).getChannel()
  } catch {
    channel = undefined
  }
  if (channel?.version) {
    // channel.json 存在：migration/setup 已选定激活版本，以此为准（即使 PATH 上仍是旧版本）
    version = channel.version
    binaryPath = channel.path
    activeSource = 'channel'
  } else {
    // 无 channel.json（未 setup 的用户）：回退探测 PATH/NPX 上的原生 claude
    activeSource = 'system'
    try {
      binaryPath = await discovery.findClaudeBinary()
      version = await discovery.getBinaryVersion(binaryPath)
    } catch (error) {
      if (error instanceof CcxError && error.code === ErrorCode.BINARY_NOT_FOUND) {
        const userConfig = configService.getUserConfig()
        const installedVersions = Object.entries(userConfig.patchedVersions).map(([v, info]) => ({
          version: v,
          targets: info.targets ?? [],
          patchedAt: info.patchedAt,
          current: false
        }))

        return {
          success: true,
          command: 'status',
          summary: t('command.status.noBinary'),
          data: {
            patched: false,
            installedVersions
          }
        }
      }

      if (error instanceof CcxError) {
        return makeErrorResult('status', error.code, error.message, error.suggestion)
      }
      throw error
    }
  }

  const userConfig = configService.getUserConfig()
  const patchedInfo = userConfig.patchedVersions[version]

  const shortcutState = readShortcutState(options?.homeDir)

  // plugin 体系：展示优先 combos（shortVer），fallback targets（兼容老 schema）
  // combos 优先；fallback 把旧 targets 数字经 formatTokenCount 转为 shortVer（与 getUserConfig 迁移逻辑一致，C6）
  const combos = patchedInfo?.combos ?? patchedInfo?.targets?.map(formatTokenCount) ?? []
  const summary = patchedInfo
    ? t('command.status.patched', { version, targets: combos.join(', ') })
    : t('command.status.unpatched', { version })

  const installedVersions = Object.entries(userConfig.patchedVersions).map(([v, info]) => ({
    version: v,
    targets: info.targets ?? [],
    patchedAt: info.patchedAt,
    current: v === version
  }))

  const next = await buildMigrationHint(options, patchedInfo, version, userConfig.patchedVersions)

  return {
    success: true,
    command: 'status',
    summary,
    data: {
      version,
      binaryPath,
      activeSource,
      patched: !!patchedInfo,
      targets: patchedInfo?.targets,
      combos: patchedInfo?.combos,
      patchedAt: patchedInfo?.patchedAt,
      shortcuts: {
        ccTarget: shortcutState.ccTarget,
        cTarget: shortcutState.cTarget,
        pointsToPatched: shortcutState.pointsToPatched
      },
      installedVersions
    },
    next
  }
}
