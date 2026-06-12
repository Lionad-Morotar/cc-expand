/**
 * cc-expand status — 显示当前 patch 状态
 */
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { readShortcutState } from '../../services/shell-profile.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export interface StatusOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
  homeDir?: string
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
  }
}
