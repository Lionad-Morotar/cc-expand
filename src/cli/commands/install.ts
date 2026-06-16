/**
 * install command — 从 npm 下载 Claude Code 到本地
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { PackageService } from '../../services/package.js'
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
      next: ['ccx patch --target 270000 --yes'],
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
