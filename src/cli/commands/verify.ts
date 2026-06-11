/**
 * cc-expand verify — 验证 patch 状态
 */
import { readFileSync } from 'node:fs'
import { DiscoveryService } from '../../services/discovery.js'
import { ConfigService } from '../../services/config.js'
import { formatSummary, highlight } from '../output.js'

export interface VerifyOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
}

export async function verifyCommand(options?: VerifyOptions): Promise<string> {
  const discovery = options?.discoveryService ?? new DiscoveryService()
  const configService = options?.configService ?? new ConfigService()

  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  const patches = await configService.getPatternForVersion(version)
  if (!patches) {
    return formatSummary('WARN', `无 pattern 数据: ${highlight(version)}`)
  }

  const content = readFileSync(binaryPath)
  const sourceValue = patches[0]?.sourceValue ?? '200000'

  const foundOriginals: string[] = []
  for (const patch of patches) {
    if (content.indexOf(Buffer.from(patch.search)) !== -1) {
      foundOriginals.push(patch.desc)
    }
  }

  if (foundOriginals.length > 0) {
    const lines = [
      formatSummary('WARN', `Claude Code ${highlight(version)} — 未 patch（发现 ${foundOriginals.length} 处原始常量）`),
      '',
      `Binary: ${highlight(binaryPath)}`,
      `源值: ${highlight(sourceValue)}`,
      '',
      '未替换项:',
    ]
    for (const desc of foundOriginals) {
      lines.push(`  ✗ ${desc}`)
    }
    return lines.join('\n')
  }

  return [
    formatSummary('OK', `Claude Code ${highlight(version)} — 已 patch（无原始常量残留）`),
    '',
    `Binary: ${highlight(binaryPath)}`,
    `源值: ${highlight(sourceValue)}`,
  ].join('\n')
}
