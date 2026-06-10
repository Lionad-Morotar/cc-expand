/**
 * install command — 从 npm 下载 Claude Code 到本地
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { PackageService } from '../../services/package.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export interface InstallOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
}

export async function installCommand(
  args: string[] = [],
  options?: InstallOptions,
): Promise<void> {
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

  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = join(homeDir, '.cc-expand', 'packages')
  const service = new PackageService(packagesDir)

  // 检查是否已安装
  if (service.isInstalled(version)) {
    console.log(`Claude Code ${version} is already installed.`)
    console.log(`  ${service.getBinaryPath(version)}`)
    return
  }

  console.log(`Downloading Claude Code ${version}...`)

  try {
    const targetDir = await service.install(version)
    const binaryPath = join(targetDir, 'bin', 'claude')
    console.log(`✓ Claude Code ${version} installed`)
    console.log(`  Binary: ${binaryPath}`)
  } catch (error) {
    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      `Failed to install Claude Code ${version}`,
      `Check your network connection and npm registry access`,
    )
  }
}
