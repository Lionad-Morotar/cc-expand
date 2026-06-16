/**
 * PatchApplier —— 把 patch 流程编排为可复用深模块
 *
 * 拆为两阶段，使命令层能在中间插入交互/批量循环：
 *
 * - prepare(version)：install 包 + 获取 pattern。返回 patches 与 sourceValue，
 *   供 patchCommand 的交互提示（位数校验、确认）和 migration 的批量复用。
 * - execute(version, target, patches)：复制 binary → 替换常量 → codesign → 验证 → 记录。
 *   每个 target 生成独立 patched binary（claude-<target>），同一版本可循环调用生成多 target。
 *
 * 设计意图：抽取自原 patchCommand 的核心，供 patchCommand（交互式单 target）与
 * migrationCommand（非交互批量）共用。本模块只关心领域行为，返回领域结果类型
 * ApplyPatchOutcome / PrepareOutcome，不依赖 cli/result.js、不涉及 CLI 渲染或交互确认。
 *
 * @see CONTEXT.md — Migration 与 Patch 的边界
 */
import { readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { PatchEngine } from '../core/patch-engine.js'
import { Verifier } from '../core/verifier.js'
import { PackageService } from './package.js'
import { ConfigService } from './config.js'
import { CcxError, ErrorCode, type PatchItem } from '../types/index.js'

/** 获取 patched binary 文件名（Windows 需 .exe 扩展名） */
export function getPatchedBinaryName(targetTokens: number): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `claude-${targetTokens}${ext}`
}

/** prepare 成功后返回的 pattern 数据 */
export interface PreparedPattern {
  patches: PatchItem[]
  sourceValue: string
}

/** execute 成功后的领域数据（CLI 无关） */
export interface AppliedPatch {
  version: string
  targetTokens: number
  sourceValue: string
  replaceCount: number
  binaryPath: string
  details: Array<{ desc: string; offset: number; sourceValue?: string; targetValue?: string }>
  /** codesign 失败时的告警（binary 可能无法执行） */
  codesignWarning?: string
}

/** 统一的失败载荷：错误码 + 用户消息 + 建议 */
export interface ApplierError {
  code: ErrorCode
  message: string
  suggestion?: string
}

export type PrepareOutcome =
  | { ok: true; data: PreparedPattern }
  | { ok: false; error: ApplierError }

export type ApplyPatchOutcome =
  | { ok: true; data: AppliedPatch }
  | { ok: false; error: ApplierError }

export interface PatchApplierOptions {
  /** 必传：提供 pattern/record 能力 */
  configService: ConfigService
  /** 覆盖默认 home 目录（测试隔离） */
  homeDir?: string
  /** 覆盖 packages 目录（测试隔离） */
  packagesDir?: string
  /** 注入 PackageService（测试用），默认基于 packagesDir 新建 */
  packageService?: PackageService
}

export class PatchApplier {
  /**
   * 阶段一：安装包 + 获取 pattern。
   * 在交互确认之前调用，使调用方能拿到 sourceValue（位数校验）与 patches（确认提示）。
   */
  async prepare(
    version: string,
    options: PatchApplierOptions,
  ): Promise<PrepareOutcome> {
    const configService = options.configService
    configService.ensureDirs()

    const homeDir = options.homeDir ?? homedir()
    const packagesDir = options.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
    const packageService = options.packageService ?? new PackageService(packagesDir)

    if (!packageService.isInstalled(version)) {
      try {
        await packageService.install(version)
      } catch (error) {
        if (error instanceof CcxError) {
          return { ok: false, error: { code: error.code, message: error.message, suggestion: error.suggestion } }
        }
        return {
          ok: false,
          error: {
            code: ErrorCode.BINARY_NOT_FOUND,
            message: `Failed to install Claude Code ${version}`,
            suggestion: 'Check your network connection and npm registry access',
          },
        }
      }
    }

    const patches = await configService.getPatternForVersion(version)
    if (!patches) {
      return {
        ok: false,
        error: {
          code: ErrorCode.PATTERN_NOT_FOUND,
          message: `No pattern found for version ${version}`,
          suggestion: `Run 'ccx supports' to see supported versions`,
        },
      }
    }

    return {
      ok: true,
      data: {
        patches: patches as PatchItem[],
        sourceValue: patches[0]?.sourceValue ?? '200000',
      },
    }
  }

  /**
   * 阶段二：对已 prepare 的版本 + patches 执行单个 target 的 patch。
   * 前置条件：版本已 prepare（包已安装）。每个 target 生成独立 patched binary，可循环调用。
   */
  async execute(
    version: string,
    targetTokens: number,
    prepared: PreparedPattern,
    options: PatchApplierOptions,
  ): Promise<ApplyPatchOutcome> {
    const configService = options.configService
    const homeDir = options.homeDir ?? homedir()
    const packagesDir = options.packagesDir ?? join(homeDir, '.cc-expand', 'packages')
    const packageService = options.packageService ?? new PackageService(packagesDir)
    const { patches, sourceValue } = prepared

    const sourceBinaryPath = packageService.getBinaryPath(version)
    if (!packageService.isInstalled(version)) {
      return {
        ok: false,
        error: {
          code: ErrorCode.BINARY_NOT_FOUND,
          message: `Claude Code ${version} is not installed`,
          suggestion: `Run 'ccx install ${version}' or 'ccx migration ${version}' first`,
        },
      }
    }

    // 复制原始 binary（不修改原始包）并执行常量替换
    const patchBinDir = join(homeDir, '.cc-expand', 'bin')
    mkdirSync(patchBinDir, { recursive: true })
    const patchedBinaryPath = join(patchBinDir, getPatchedBinaryName(targetTokens))

    copyFileSync(sourceBinaryPath, patchedBinaryPath)
    chmodSync(patchedBinaryPath, 0o755)

    const buffer = readFileSync(patchedBinaryPath)
    const engine = new PatchEngine()
    const patchResult = engine.patch(buffer, patches, targetTokens)

    if (!patchResult.success) {
      rmSync(patchedBinaryPath, { force: true })
      return {
        ok: false,
        error: patchResult.error
          ? { code: patchResult.error.code, message: patchResult.error.message, suggestion: patchResult.error.suggestion }
          : { code: ErrorCode.PATCH_FAILED, message: 'Patch failed' },
      }
    }
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

    // 验证（替换完整性 + 可执行性）
    const verifier = new Verifier()
    const verifyResult = await verifier.verify({
      binaryPath: patchedBinaryPath,
      targetTokens,
      sourceValue,
      patches,
    })
    if (!verifyResult.success) {
      rmSync(patchedBinaryPath, { force: true })
      return {
        ok: false,
        error: verifyResult.error
          ? { code: verifyResult.error.code, message: verifyResult.error.message, suggestion: verifyResult.error.suggestion }
          : { code: ErrorCode.VERIFICATION_FAILED, message: 'Verification failed' },
      }
    }

    // 记录到 versions.json
    configService.recordPatchedVersion(version, targetTokens)

    return {
      ok: true,
      data: {
        version,
        targetTokens,
        sourceValue,
        replaceCount: patchResult.replaceCount ?? 0,
        binaryPath: patchedBinaryPath,
        details: patchResult.details,
        codesignWarning,
      },
    }
  }
}
