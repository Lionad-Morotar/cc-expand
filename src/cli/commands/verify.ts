/**
 * cc-expand verify — 验证 patch 状态
 */
import { readFileSync } from 'node:fs'
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'

export async function verifyCommand(): Promise<void> {
  const discovery = new DiscoveryService()
  const configService = new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  console.log(`Claude Code ${version} at ${binaryPath}`)

  const versionConfig = configService.getPatternForVersion(version)
  if (!versionConfig) {
    console.log(`⚠ No pattern data for version ${version}`)
    return
  }

  const content = readFileSync(binaryPath)
  const sourceValue = versionConfig.patches[0]?.sourceValue ?? '200000'

  let hasOriginal = false
  for (const patch of versionConfig.patches) {
    if (content.indexOf(Buffer.from(patch.search)) !== -1) {
      hasOriginal = true
      console.log(`✗ Not patched — still contains "${patch.search}"`)
    }
  }

  if (!hasOriginal) {
    console.log(`✓ Binary appears patched (no original patterns found)`)
  }
}
