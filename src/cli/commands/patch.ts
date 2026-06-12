/**
 * cc-expand patch — 交互式 patch 命令
 * 从本地包复制 binary → patch → 保存到 ~/.cc-expand/bin/
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
import { UserConfigService } from '../../services/user-config.js'
import { maintainShellShortcuts } from '../../services/shell-maintain.js'
import { CcxError, ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'
import { parseTokenCount } from '../../utils/parse-token-count.js'

/** 获取 patched binary 文件名（Windows 需 .exe 扩展名） */
export function getPatchedBinaryName(targetTokens: number): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `claude-${targetTokens}${ext}`
}

export interface PatchData {
  version: string
  targetTokens: number
  sourceValue: string
  replaceCount: number
  binaryPath: string
  details: Array<{ desc: string; offset: number }>
  shortcutsUpdated: boolean
}

export interface PatchOptions {
  configService?: ConfigService
  userConfigService?: UserConfigService
  homeDir?: string
  packagesDir?: string
}

export async function patchCommand(
  args: string[] = [],
  options?: PatchOptions,
): Promise<CommandResult<PatchData>> {
  const configService = options?.configService ?? new ConfigService()
  const userConfigService = options?.userConfigService ?? new UserConfigService()
  configService.ensureDirs()

  // 解析命令行参数
  let targetTokens: number | undefined
  let skipConfirm = false
  let version: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      const next = args[i + 1]
      if (next === undefined) {
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          `--target requires a value`,
          `Usage: ccx patch --target 256000`,
        )
      }
      try {
        targetTokens = parseTokenCount(next)
      } catch (error) {
        const message = error instanceof CcxError ? error.message : String(error)
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          message,
          `Usage: ccx patch --target 256000`,
        )
      }
      i++
    } else if (args[i] === '--yes' || args[i] === '-y') {
      skipConfirm = true
    } else if (args[i] === '--version' || args[i] === '-v') {
      const next = args[i + 1]
      if (next === undefined || next.startsWith('-')) {
        return makeErrorResult(
          'patch',
          ErrorCode.INVALID_TARGET,
          `--version requires a value`,
          `Usage: ccx patch --version 2.1.170`,
        )
      }
      version = normalizeVersion(next)
      i++
    }
  }

  // --yes 必须配合 --target 使用
  if (skipConfirm && targetTokens === undefined) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      '--yes requires --target',
      'Usage: ccx patch --target 256000 --yes',
    )
  }

  // 验证 target tokens 有效（提前拒绝，避免不必要的 I/O）
  if (targetTokens !== undefined && targetTokens <= 0) {
    return makeErrorResult(
      'patch',
      ErrorCode.INVALID_TARGET,
      `Invalid target tokens: ${targetTokens}`,
      `Target must be a positive integer (e.g. 256000)`,
    )
  }

  // 确定版本：命令行 > channel.json > 报错
  if (!version) {
    const homeDir = options?.homeDir ?? homedir()
    const configDir = join(homeDir, '.cc-expand')
    const channelConfig = new ChannelConfig(configDir)
    const channel = channelConfig.getChannel()
    version = channel?.version
  }

  if (!version) {
    return makeErrorResult(
      'patch',
      ErrorCode.BINARY_NOT_FOUND,
      'No version specified',
      'Use --version or run setup first to select a version',
    )
  }

  // 确保包已安装
  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = options?.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
  const packageService = new PackageService(packagesDir)

  if (!packageService.isInstalled(version)) {
    try {
      await packageService.install(version)
    } catch (error) {
      if (error instanceof CcxError) {
        return makeErrorResult('patch', error.code, error.message, error.suggestion)
      }
      return makeErrorResult(
        'patch',
        ErrorCode.BINARY_NOT_FOUND,
        `Failed to install Claude Code ${version}`,
        'Check your network connection and npm registry access',
      )
    }
  }

  const sourceBinaryPath = packageService.getBinaryPath(version)

  // 获取版本对应的模式
  const patches = await configService.getPatternForVersion(version)
  if (!patches) {
    return makeErrorResult(
      'patch',
      ErrorCode.PATTERN_NOT_FOUND,
      `No pattern found for version ${version}`,
      `Run 'ccx supports' to see supported versions`,
    )
  }

  // 获取目标 tokens
  const sourceValue = patches[0]?.sourceValue ?? '200000'

  if (targetTokens === undefined) {
    // 交互式模式
    const { input } = await import('@inquirer/prompts')
    const targetInput = await input({
      message: `Current context window: ${sourceValue}\nEnter target tokens (e.g. 256000 or 270k):`,
      validate: (value: string) => {
        try {
          const parsed = parseTokenCount(value)
          if (String(parsed).length !== sourceValue.length) {
            return `Must be ${sourceValue.length} digits`
          }
          return true
        } catch (e) {
          return e instanceof CcxError ? e.message : 'Please enter a valid number'
        }
      },
    })
    targetTokens = parseTokenCount(targetInput)
  }

  // 确认
  if (!skipConfirm) {
    const { confirm } = await import('@inquirer/prompts')
    const confirmed = await confirm({
      message: `Replace ${patches.length} constant(s) from ${sourceValue} to ${targetTokens}?`,
    })

    if (!confirmed) {
      return {
        success: true,
        command: 'patch',
        summary: 'Patch cancelled',
        data: {
          version,
          targetTokens,
          sourceValue,
          replaceCount: 0,
          binaryPath: '',
          details: [],
          shortcutsUpdated: false,
        },
      }
    }
  }

  // 创建 patched binary 目录
  const patchBinDir = join(homeDir, '.cc-expand', 'bin')
  mkdirSync(patchBinDir, { recursive: true })
  const patchedBinaryPath = join(patchBinDir, getPatchedBinaryName(targetTokens))

  // 复制原始 binary（不修改原始包）
  copyFileSync(sourceBinaryPath, patchedBinaryPath)
  chmodSync(patchedBinaryPath, 0o755)

  // Patch
  const buffer = readFileSync(patchedBinaryPath)
  const engine = new PatchEngine()
  const patchResult = engine.patch(buffer, patches, targetTokens)

  if (!patchResult.success) {
    rmSync(patchedBinaryPath, { force: true })
    if (patchResult.error instanceof CcxError) {
      return makeErrorResult('patch', patchResult.error.code, patchResult.error.message, patchResult.error.suggestion)
    }
    return makeErrorResult('patch', ErrorCode.PATCH_FAILED, 'Patch failed')
  }

  // 写入修改后的二进制
  writeFileSync(patchedBinaryPath, buffer)

  // macOS codesign（重新签名）
  let codesignWarning: string | undefined
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --sign - --force --deep "${patchedBinaryPath}"`, { stdio: 'ignore' })
    } catch {
      codesignWarning = 'codesign failed — binary may not be executable'
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
    if (verifyResult.error instanceof CcxError) {
      return makeErrorResult('patch', verifyResult.error.code, verifyResult.error.message, verifyResult.error.suggestion)
    }
    return makeErrorResult('patch', ErrorCode.VERIFICATION_FAILED, 'Verification failed')
  }

  // 记录
  configService.recordPatchedVersion(version, targetTokens)

  // 自动维护 shell 快捷方式（可由用户配置关闭）
  let shortcutsUpdated = false
  let maintainSummary = ''
  const autoMaintain = userConfigService.get('autoMaintain')
  if (autoMaintain) {
    maintainSummary = await maintainShellShortcuts({
      targetTokens,
      skipConfirm,
      homeDir,
    })
    shortcutsUpdated = true
  }

  return {
    success: true,
    command: 'patch',
    summary: t('command.patch.success', { version, targetTokens }),
    data: {
      version,
      targetTokens,
      sourceValue,
      replaceCount: patchResult.replaceCount ?? 0,
      binaryPath: patchedBinaryPath,
      details: patchResult.details,
      shortcutsUpdated,
    },
    next: [
      `ccx run ${targetTokens}`,
      `cc ${targetTokens}`,
    ],
    warnings: codesignWarning ? [codesignWarning] : undefined,
  }
}
