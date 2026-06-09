/**
 * cc-expand run — 启动已 patch 的 Claude Code
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export async function runCommand(targetTokens?: string): Promise<void> {
  const discovery = new DiscoveryService()
  const configService = new ConfigService()

  // 1. 找到 Claude Code
  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  // 2. 检查是否已 patch
  const userConfig = configService.getUserConfig()
  const patchedInfo = userConfig.patchedVersions[version]

  if (!patchedInfo) {
    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      `Claude Code ${version} has not been patched yet`,
      'Run "cc-expand patch" first',
    )
  }

  // 3. 启动（直接传参给 claude）
  const args = targetTokens ? [targetTokens] : []
  const child = spawn(binaryPath, args, {
    stdio: 'inherit',
    detached: false,
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}
