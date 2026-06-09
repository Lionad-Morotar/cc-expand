/**
 * cc-expand patch — 交互式 patch 命令
 * 自动发现 Claude Code → 备份 → patch → 验证
 *
 * 用法:
 *   cc-expand patch                    # 交互式模式
 *   cc-expand patch --target 256000    # 非交互式，直接指定目标值
 *   cc-expand patch --target 256000 --yes  # 非交互式，跳过确认
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { input, confirm } from '@inquirer/prompts'
import { PatchEngine } from '../../core/patch-engine.js'
import { Verifier } from '../../core/verifier.js'
import { DiscoveryService } from '../../services/discovery.js'
import { BackupService } from '../../services/backup.js'
import { ConfigService } from '../../services/config.js'
import { CcxError, ErrorCode } from '../../types/index.js'

export async function patchCommand(args: string[] = []): Promise<void> {
  const configService = new ConfigService()
  configService.ensureDirs()

  // 解析命令行参数
  let targetTokens: number | undefined
  let skipConfirm = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      targetTokens = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--yes' || args[i] === '-y') {
      skipConfirm = true
    }
  }

  // 1. 发现 Claude Code
  const discovery = new DiscoveryService()
  const binaryPath = await discovery.findClaudeBinary()
  const version = await discovery.getBinaryVersion(binaryPath)

  console.log(`Found Claude Code ${version} at ${binaryPath}`)

  // 2. 获取版本对应的模式
  const patches = configService.getPatternForVersion(version)
  if (!patches) {
    throw new CcxError(
      ErrorCode.PATTERN_NOT_FOUND,
      `No pattern found for version ${version}`,
      `Check patterns.json for supported versions or run: grep -ao "200000" "${binaryPath}"`,
    )
  }

  // 3. 获取目标 tokens
  const sourceValue = patches[0]?.sourceValue ?? '200000'

  if (targetTokens === undefined) {
    // 交互式模式
    const targetInput = await input({
      message: `Current context window: ${sourceValue}\nEnter target tokens (e.g. 256000):`,
      validate: (value) => {
        if (!/^\d+$/.test(value)) return 'Please enter a valid number'
        if (value.length !== sourceValue.length) {
          return `Must be ${sourceValue.length} digits`
        }
        return true
      },
    })
    targetTokens = parseInt(targetInput, 10)
  }

  // 4. 确认
  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Replace ${patches.length} constant(s) from ${sourceValue} to ${targetTokens}?`,
    })

    if (!confirmed) {
      console.log('Patch cancelled.')
      return
    }
  }

  // 5. 备份
  const backupService = new BackupService()
  const backupDir = configService.getBackupDir()
  await backupService.backup(binaryPath, backupDir)
  console.log(`Backup created at ${backupDir}`)

  // 6. Patch
  const buffer = readFileSync(binaryPath)
  const engine = new PatchEngine()
  const patchResult = engine.patch(buffer, patches, targetTokens)

  if (!patchResult.success) {
    throw patchResult.error ?? new CcxError(ErrorCode.PATCH_FAILED, 'Patch failed')
  }

  console.log(`Patched ${patchResult.replaceCount} occurrence(s):`)
  for (const detail of patchResult.details) {
    console.log(`  - ${detail.desc} at offset ${detail.offset}`)
  }

  // 7. 写入修改后的二进制
  writeFileSync(binaryPath, buffer)

  // 8. macOS codesign（重新签名）
  if (process.platform === 'darwin') {
    try {
      const { execSync } = await import('node:child_process')
      execSync(`codesign --sign - --force --deep "${binaryPath}"`, { stdio: 'ignore' })
      console.log('Self-signed with codesign ✓')
    } catch {
      console.warn('⚠ codesign failed — binary may not be executable')
    }
  }

  // 9. 验证
  const verifier = new Verifier()
  const verifyResult = await verifier.verify({
    binaryPath,
    targetTokens,
    sourceValue,
    patches,
  })

  if (!verifyResult.success) {
    // 自动恢复
    await backupService.restore(binaryPath, backupDir)
    throw verifyResult.error ?? new CcxError(ErrorCode.VERIFICATION_FAILED, 'Verification failed, auto-restored')
  }

  console.log('Verification passed ✓')

  // 9. 记录
  configService.recordPatchedVersion(version, targetTokens)
  console.log(`Done! Claude Code ${version} now uses ${targetTokens} tokens context window.`)
}
