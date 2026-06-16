/**
 * cc-expand status — 显示当前 patch 状态
 * 当检测到 npm 有新版本且当前版本已 patch 时，在 next 步骤建议 migration，
 * 引导用户走更短的升级路径。latest 查询用 queryLatestVersion（execFile timeout 自动 kill），
 * 失败/超时静默返回 undefined，绝不破坏主输出或阻塞进程退出。
 */
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { queryLatestVersion } from '../../services/latest-checker.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { isVersionGreater } from '../../utils/version.js'
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
  patched: boolean
  targets?: number[]
  patchedAt?: string
  shortcuts?: {
    ccTarget?: string
    cTarget?: string
    pointsToPatched: boolean
  }
  installedVersions: Array<{
    version: string
    targets: number[]
    patchedAt: string
    current: boolean
  }>
}

/** 当前版本已 patch 且 npm latest 更新时，建议 migration；否则无 next */
async function buildMigrationHint(
  options: StatusOptions | undefined,
  patchedInfo: { targets: number[]; patchedAt: string } | undefined,
  currentVersion: string,
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
  if (latest && isVersionGreater(latest, currentVersion)) {
    return ['ccx migration latest']
  }
  return undefined
}

export async function statusCommand(options?: StatusOptions): Promise<CommandResult<StatusData>> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const configService = options?.configService ?? new ConfigService()

  let binaryPath: string | undefined
  let version: string | undefined

  try {
    binaryPath = await discovery.findClaudeBinary()
    version = await discovery.getBinaryVersion(binaryPath)
  } catch (error) {
    if (error instanceof CcxError && error.code === ErrorCode.BINARY_NOT_FOUND) {
      const userConfig = configService.getUserConfig()
      const installedVersions = Object.entries(userConfig.patchedVersions).map(([v, info]) => ({
        version: v,
        targets: info.targets,
        patchedAt: info.patchedAt,
        current: false,
      }))

      return {
        success: true,
        command: 'status',
        summary: t('command.status.noBinary'),
        data: {
          patched: false,
          installedVersions,
        },
      }
    }

    if (error instanceof CcxError) {
      return makeErrorResult('status', error.code, error.message, error.suggestion)
    }
    throw error
  }

  const userConfig = configService.getUserConfig()
  const patchedInfo = userConfig.patchedVersions[version]

  const shortcutState = readShortcutState(options?.homeDir)

  const summary = patchedInfo
    ? t('command.status.patched', { version, targets: patchedInfo.targets.join(', ') })
    : t('command.status.unpatched', { version })

  const installedVersions = Object.entries(userConfig.patchedVersions).map(([v, info]) => ({
    version: v,
    targets: info.targets,
    patchedAt: info.patchedAt,
    current: v === version,
  }))

  const next = await buildMigrationHint(options, patchedInfo, version)

  return {
    success: true,
    command: 'status',
    summary,
    data: {
      version,
      binaryPath,
      patched: !!patchedInfo,
      targets: patchedInfo?.targets,
      patchedAt: patchedInfo?.patchedAt,
      shortcuts: {
        ccTarget: shortcutState.ccTarget,
        cTarget: shortcutState.cTarget,
        pointsToPatched: shortcutState.pointsToPatched,
      },
      installedVersions,
    },
    next,
  }
}
