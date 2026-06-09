/**
 * cc-expand status — 显示当前 patch 状态
 */
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'

export async function statusCommand(): Promise<void> {
  const discovery = new DiscoveryService()
  const configService = new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  console.log(`Binary: ${binaryPath}`)
  console.log(`Version: ${version}`)

  const userConfig = configService.getUserConfig()
  const patchedInfo = userConfig.patchedVersions[version]

  if (patchedInfo) {
    console.log(`Status: Patched to ${patchedInfo.targetTokens} tokens`)
    console.log(`Patched at: ${patchedInfo.patchedAt}`)
  } else {
    console.log(`Status: Unpatched (default context window)`)
  }
}
