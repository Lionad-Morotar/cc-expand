/**
 * cc-expand patch — 交互式 patch 命令
 * 从本地包复制 binary → patch → 保存到 ~/.cc-expand/bin/
 *
 * 用法:
 *   cc-expand patch                    # 交互式模式
 *   cc-expand patch --target 256000    # 非交互式，直接指定目标值
 *   cc-expand patch --target 256000 --yes  # 非交互式，跳过确认
 */
import { readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { PatchEngine } from '../../core/patch-engine.js'
import { Verifier } from '../../core/verifier.js'
import { PackageService } from '../../services/package.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { ConfigService } from '../../services/config.js'
import { CcxError, ErrorCode } from '../../types/index.js'

/** 获取 patched binary 文件名（Windows 需 .exe 扩展名） */
export function getPatchedBinaryName(targetTokens: number): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `claude-${targetTokens}${ext}`
}

export async function patchCommand(args: string[] = []): Promise<void> {
  const configService = new ConfigService()
  configService.ensureDirs()

  // 解析命令行参数
  let targetTokens: number | undefined
  let skipConfirm = false
  let version: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      const next = args[i + 1]
      if (next === undefined || !/^\d+$/.test(next)) {
        throw new CcxError(
          ErrorCode.INVALID_TARGET,
          `--target requires a valid positive integer`,
          `Usage: cc-expand patch --target 256000`,
        )
      }
      targetTokens = parseInt(next, 10)
      i++
    } else if (args[i] === '--yes' || args[i] === '-y') {
      skipConfirm = true
    } else if (args[i] === '--version' || args[i] === '-v') {
      const next = args[i + 1]
      if (next === undefined || next.startsWith('-')) {
        throw new CcxError(
          ErrorCode.INVALID_TARGET,
          `--version requires a value`,
          `Usage: cc-expand patch --version 2.1.170`,
        )
      }
      version = next
      i++
    }
  }

  // --yes 必须配合 --target 使用
  if (skipConfirm && targetTokens === undefined) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      '--yes requires --target',
      'Usage: cc-expand patch --target 256000 --yes',
    )
  }

  // 验证 target tokens 有效（提前拒绝，避免不必要的 I/O）
  if (targetTokens !== undefined && targetTokens <= 0) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${targetTokens}`,
      `Target must be a positive integer (e.g. 256000)`,
    )
  }

  // 确定版本：命令行 > channel.json > 报错
  if (!version) {
    const channelConfig = new ChannelConfig()
    const channel = channelConfig.getChannel()
    version = channel?.version
  }

  if (!version) {
    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      'No version specified',
      'Use --version or run setup first to select a version',
    )
  }

  // 确保包已安装
  const packagesDir = join(homedir(), '.cc-expand', 'packages')
  const packageService = new PackageService(packagesDir)

  if (!packageService.isInstalled(version)) {
    console.log(`Claude Code ${version} not installed. Downloading...`)
    await packageService.install(version)
  }

  const sourceBinaryPath = packageService.getBinaryPath(version)
  console.log(`Using Claude Code ${version}`)

  // 获取版本对应的模式
  const patches = configService.getPatternForVersion(version)
  if (!patches) {
    throw new CcxError(
      ErrorCode.PATTERN_NOT_FOUND,
      `No pattern found for version ${version}`,
      `Check patterns.json for supported versions`,
    )
  }

  // 获取目标 tokens
  const sourceValue = patches[0]?.sourceValue ?? '200000'

  if (targetTokens === undefined) {
    // 交互式模式
    const { input } = await import('@inquirer/prompts')
    const targetInput = await input({
      message: `Current context window: ${sourceValue}\nEnter target tokens (e.g. 256000):`,
      validate: (value: string) => {
        if (!/^\d+$/.test(value)) return 'Please enter a valid number'
        if (value.length !== sourceValue.length) {
          return `Must be ${sourceValue.length} digits`
        }
        return true
      },
    })
    targetTokens = parseInt(targetInput, 10)
  }

  // 确认
  if (!skipConfirm) {
    const { confirm } = await import('@inquirer/prompts')
    const confirmed = await confirm({
      message: `Replace ${patches.length} constant(s) from ${sourceValue} to ${targetTokens}?`,
    })

    if (!confirmed) {
      console.log('Patch cancelled.')
      return
    }
  }

  // 创建 patched binary 目录
  const patchBinDir = join(homedir(), '.cc-expand', 'bin')
  mkdirSync(patchBinDir, { recursive: true })
  const patchedBinaryPath = join(patchBinDir, getPatchedBinaryName(targetTokens))

  // 复制原始 binary（不修改原始包）
  copyFileSync(sourceBinaryPath, patchedBinaryPath)
  chmodSync(patchedBinaryPath, 0o755)
  console.log(`Created patched binary: ${patchedBinaryPath}`)

  // Patch
  const buffer = readFileSync(patchedBinaryPath)
  const engine = new PatchEngine()
  const patchResult = engine.patch(buffer, patches, targetTokens)

  if (!patchResult.success) {
    rmSync(patchedBinaryPath, { force: true })
    throw patchResult.error ?? new CcxError(ErrorCode.PATCH_FAILED, 'Patch failed')
  }

  console.log(`Patched ${patchResult.replaceCount} occurrence(s):`)
  for (const detail of patchResult.details) {
    console.log(`  - ${detail.desc} at offset ${detail.offset}`)
  }

  // 写入修改后的二进制
  writeFileSync(patchedBinaryPath, buffer)

  // macOS codesign（重新签名）
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --sign - --force --deep "${patchedBinaryPath}"`, { stdio: 'ignore' })
      console.log('Self-signed with codesign ✓')
    } catch {
      console.warn('⚠ codesign failed — binary may not be executable')
    }
  }

  // 验证
  const verifier = new Verifier()
  const verifyResult = await verifier.verify({
    binaryPath: patchedBinaryPath,
    targetTokens,
    sourceValue,
    patches,
  })

  if (!verifyResult.success) {
    rmSync(patchedBinaryPath, { force: true })
    throw verifyResult.error ?? new CcxError(ErrorCode.VERIFICATION_FAILED, 'Verification failed')
  }

  console.log('Verification passed ✓')

  // 记录
  configService.recordPatchedVersion(version, targetTokens)
  console.log(`Done! Claude Code ${version} now uses ${targetTokens} tokens context window.`)
}
