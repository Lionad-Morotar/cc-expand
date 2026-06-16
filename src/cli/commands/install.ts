/**
 * install command — 从 npm 下载 Claude Code 到本地
 * 成功后根据是否存在历史 patch 记录，next 建议 migration（升级场景）或 patch（首次设定）
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { PackageService } from '../../services/package.js'
import { ConfigService } from '../../services/config.js'
import { CcxError, ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'

export interface InstallData {
  version: string
  binaryPath: string
  alreadyInstalled: boolean
}

export interface InstallOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
  packageService?: PackageService
  /** 注入以读取 patchedVersions 历史，决定 next 建议 patch 还是 migration */
  configService?: ConfigService
}

/** 有历史 patch 记录 → 建议 migration；否则建议 patch（首次设定） */
function nextStepsFor(configService: ConfigService, version: string): string[] {
  const hasHistory = Object.keys(configService.getUserConfig().patchedVersions ?? {}).length > 0
  return hasHistory ? [`ccx migration ${version}`] : ['ccx patch --target 270000 --yes']
}

export async function installCommand(
  args: string[] = [],
  options?: InstallOptions,
): Promise<CommandResult<InstallData>> {
  // 解析版本号：位置参数（如 install 2.1.170），缺省为 latest
  let version = 'latest'
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      version = normalizeVersion(arg)
      break
    }
  }

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = join(homeDir, '.cc-expand', 'packages')
  const service = options?.packageService ?? new PackageService(packagesDir)
  const configService = options?.configService ?? new ConfigService({ homeDir })

  let resolvedVersion: string
  try {
    resolvedVersion = await service.resolveVersion(version)
  } catch (error) {
    return makeErrorResult(
      'install',
      ErrorCode.BINARY_NOT_FOUND,
      `Failed to resolve version ${version}`,
      'Check your network connection and npm registry access',
    )
  }

  if (service.isInstalled(resolvedVersion)) {
    const binaryPath = service.getBinaryPath(resolvedVersion)
    return {
      success: true,
      command: 'install',
      summary: t('command.install.alreadyInstalled', { version: resolvedVersion }),
      data: {
        version: resolvedVersion,
        binaryPath,
        alreadyInstalled: true,
      },
      next: nextStepsFor(configService, resolvedVersion),
    }
  }

  try {
    const { targetDir, version: installedVersion } = await service.install(version)
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const binaryPath = join(targetDir, 'bin', binaryName)

    return {
      success: true,
      command: 'install',
      summary: t('command.install.success', { version: installedVersion }),
      data: {
        version: installedVersion,
        binaryPath,
        alreadyInstalled: false,
      },
      next: nextStepsFor(configService, installedVersion),
    }
  } catch (error) {
    if (error instanceof CcxError) {
      return makeErrorResult('install', error.code, error.message, error.suggestion)
    }
    return makeErrorResult(
      'install',
      ErrorCode.BINARY_NOT_FOUND,
      `Failed to install Claude Code ${version}`,
      'Check your network connection and npm registry access',
    )
  }
}
