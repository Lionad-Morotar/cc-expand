/**
 * cc-expand verify — 验证 patch 状态
 * 当发现未 patch 且存在历史 patch 记录时（典型为升级后漏 patch），
 * next 建议 migration 从历史记录恢复配置。
 */
import { readFileSync } from 'node:fs'
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export interface VerifyData {
  version: string
  binaryPath: string
  sourceValue: string
  patched: boolean
  foundOriginals: string[]
}

export interface VerifyOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
}

export async function verifyCommand(options?: VerifyOptions): Promise<CommandResult<VerifyData>> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const configService = options?.configService ?? new ConfigService()

  let binaryPath: string
  let version: string
  try {
    binaryPath = await discovery.findClaudeBinary()
    version = await discovery.getBinaryVersion(binaryPath)
  } catch (error) {
    if (error instanceof CcxError) {
      return makeErrorResult('verify', error.code, error.message, error.suggestion)
    }
    throw error
  }

  const patches = await configService.getPatternForVersion(version)
  if (!patches) {
    return makeErrorResult(
      'verify',
      ErrorCode.PATTERN_NOT_FOUND,
      `No pattern data for ${version}`,
      'Run `ccx supports` to see supported versions',
    )
  }

  const content = readFileSync(binaryPath)
  const sourceValue = patches[0]?.sourceValue ?? '200000'

  const foundOriginals: string[] = []
  for (const patch of patches) {
    if (content.indexOf(Buffer.from(patch.search)) !== -1) {
      foundOriginals.push(patch.desc)
    }
  }

  const patched = foundOriginals.length === 0

  // 未 patch 且有历史记录 → 可能升级后漏 patch，建议从历史迁移恢复
  const hasHistory = Object.keys(configService.getUserConfig().patchedVersions ?? {}).length > 0
  const next = !patched && hasHistory ? [`ccx migration ${version}`] : undefined

  return {
    success: true,
    command: 'verify',
    // 未 patch 用 warning 严重级别，渲染器显示黄色 [WARN] 而非绿色 [OK]，避免"验证通过"的视觉误导
    severity: patched ? undefined : 'warning',
    summary: patched
      ? t('command.verify.patched', { version })
      : t('command.verify.unpatched', { version, count: foundOriginals.length }),
    data: {
      version,
      binaryPath,
      sourceValue,
      patched,
      foundOriginals,
    },
    next,
  }
}
