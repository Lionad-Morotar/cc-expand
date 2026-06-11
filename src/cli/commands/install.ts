/**
 * install command — 从 npm 下载 Claude Code 到本地
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { PackageService } from '../../services/package.js'
import { CcxError, ErrorCode } from '../../types/index.js'
import { formatSummary, highlight, formatNextSteps } from '../output.js'

export interface InstallOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
}

export async function installCommand(
  args: string[] = [],
  options?: InstallOptions,
): Promise<string> {
  // 解析版本号：支持位置参数或 --version
  let version = 'latest'
  // 第一轮：找 --version 标志
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--version' || args[i] === '-v') && args[i + 1]) {
      version = args[i + 1]
      i++
      break
    }
  }
  // 第二轮：找第一个非选项位置参数（如果 --version 未指定）
  if (version === 'latest') {
    for (const arg of args) {
      if (!arg.startsWith('-')) {
        version = arg
        break
      }
    }
  }

  // 兼容 v 前缀（如 v2.1.172 → 2.1.172）
  if (version.startsWith('v')) {
    version = version.slice(1)
  }

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = join(homeDir, '.cc-expand', 'packages')
  const service = new PackageService(packagesDir)

  // 解析 latest 到实际版本号，以便后续检查、输出和 patch 匹配 patterns.json
  const resolvedVersion = await service.resolveVersion(version)

  // 检查是否已安装（使用解析后的实际版本）
  if (service.isInstalled(resolvedVersion)) {
    return [
      formatSummary('INFO', `Claude Code ${resolvedVersion} 已安装`),
      '',
      `Binary: ${highlight(service.getBinaryPath(resolvedVersion))}`,
    ].join('\n')
  }

  try {
    const { targetDir, version: installedVersion } = await service.install(version)
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const binaryPath = join(targetDir, 'bin', binaryName)

    return [
      formatSummary('OK', `Claude Code ${installedVersion} 安装成功`),
      '',
      `Binary: ${highlight(binaryPath)}`,
      formatNextSteps([
        `cc-expand patch --target 270000 --yes   # 创建 patch 版本`,
      ]),
    ].join('\n')
  } catch (error) {
    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      `Failed to install Claude Code ${version}`,
      `Check your network connection and npm registry access`,
    )
  }
}
