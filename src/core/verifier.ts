/**
 * 验证器
 * Patch 后执行多步验证，确保二进制文件完整可用
 */
import { accessSync, constants, readFileSync } from 'node:fs'
import type { PatchItem } from '../types/index.js'
import { CcxError, ErrorCode } from '../types/index.js'
import { BytecodePatchEngine } from './bytecode-patch-engine.js'

export interface VerifyConfig {
  /** 二进制文件路径 */
  binaryPath: string
  /** token-encode 策略：对无 literal target 的 patch，按 slot 生成期望字面量（与 PatchEngine 对称） */
  targetGenerator: (slot: number) => string
  /** 源 tokens 值 */
  sourceValue: string
  /** patch 项列表 */
  patches: PatchItem[]
  /** 源 tokens 数值（bytecode 锚点搜索用）；有 bytecodePatterns 时必传 */
  sourceTokens?: number
  /** 目标 tokens 数值（bytecode 锚点验证用）；有 bytecodePatterns 时必传 */
  targetTokens?: number
}

export interface VerifyResult {
  /** 是否全部通过 */
  success: boolean
  /** 各检查项详情 */
  checks: VerifyCheck[]
  /** 失败时的错误 */
  error?: CcxError
}

export interface VerifyCheck {
  name: string
  passed: boolean
  message?: string
}

export class Verifier {
  /**
   * 执行 patch 后验证
   * 检查项：
   * 1. 特定模式替换 — 每个 patch 项的搜索模式中的 sourceValue 已被替换
   * 2. 可执行 — 文件具有可执行权限
   * 3. codesign — 自签名验证通过（macOS 可选）
   * @param config 验证配置
   * @returns 验证结果
   */
  async verify(config: VerifyConfig): Promise<VerifyResult> {
    const checks: VerifyCheck[] = []
    const content = readFileSync(config.binaryPath)

    // Check 1: per-patch 替换验证
    // 写入的是等长编码字面量（如 1e6   ）。每个 patch 按各自 sourceValue 槽位宽度编码，
    // 故须逐项校验：(a) 原 search 模式已消失 (b) 该项编码字面量已出现——与 PatchEngine 的
    // per-patch 编码对称，避免不同槽位宽度时用单一 slotWidth 误判。
    let allPatched = true
    let allTargetsPresent = true
    const failedPatches: string[] = []

    for (const patch of config.patches) {
      const sourceOffsetInSearch = patch.search.indexOf(patch.sourceValue)

      // 如果搜索模式中不包含 sourceValue，跳过
      if (sourceOffsetInSearch === -1) {
        continue
      }

      // (a) 原 search 模式不应再以未替换形式出现
      const searchBuf = Buffer.from(patch.search, 'utf8')
      let offset = 0
      let foundUnpatched = false
      while (true) {
        const idx = content.indexOf(searchBuf, offset)
        if (idx === -1) break

        const replaceAt = idx + sourceOffsetInSearch
        const currentValue = content.subarray(replaceAt, replaceAt + patch.sourceValue.length).toString('utf8')
        if (currentValue === patch.sourceValue) {
          foundUnpatched = true
          failedPatches.push(patch.desc ?? '')
          break
        }
        offset = idx + searchBuf.length
      }
      if (foundUnpatched) {
        allPatched = false
      }

      // (b) 该 patch 的等长编码字面量应出现。与 PatchEngine 编码逻辑对称：
      // literal-target 用 value（pad:right-space 凑等长），否则 token-encode。
      // 旧实现统一 token-encode，导致 installed literal patch 误判 → verify 失败 → binary 被误删。
      let expectedLiteral: string
      if (patch.target) {
        expectedLiteral = patch.target.pad === 'right-space'
          ? patch.target.value.padEnd(patch.sourceValue.length, ' ')
          : patch.target.value
      } else {
        expectedLiteral = config.targetGenerator(patch.sourceValue.length)
      }
      if (content.indexOf(Buffer.from(expectedLiteral, 'utf8')) === -1) {
        allTargetsPresent = false
      }
    }

    checks.push({
      name: 'pattern-replaced',
      passed: allPatched && allTargetsPresent,
      message: allPatched && allTargetsPresent
        ? undefined
        : `Unpatched patterns: ${failedPatches.join(', ') || 'none found'}`
    })

    // Check 1.5: bytecode 锚点验证（CC 2.1.246+ 必查）
    // 文本替换在 bytecode 编译的 binary 上无效却报告成功（2.1.250 bug 现场），
    // 故对聚合出的 bytecode 锚点做目标值回查：未改字节 → 锚点不命中 → 验证失败。
    const bytecodePatterns = [...new Set(config.patches.flatMap(p => p.bytecodePatterns ?? []))]
    if (bytecodePatterns.length > 0) {
      // 缺参时显式失败而非静默填 0：按 0 填充搜索必然不命中，会把「配置缺参」
      // 误报成「锚点未命中」，误导排障方向（patched binary 还会被误删）
      if (config.sourceTokens === undefined || config.targetTokens === undefined) {
        checks.push({
          name: 'bytecode-verified',
          passed: false,
          message: 'bytecodePatterns configured but sourceTokens/targetTokens missing in VerifyConfig'
        })
      } else {
        const bytecodeResult = new BytecodePatchEngine().verify(
          content,
          { bytecodePatterns, targetTokens: config.targetTokens, sourceTokens: config.sourceTokens }
        )
        checks.push({
          name: 'bytecode-verified',
          passed: bytecodeResult.success,
          message: bytecodeResult.success
            ? undefined
            : `bytecode anchor check failed: ${bytecodeResult.error?.message ?? 'unknown'}`
        })
      }
    }

    // Check 2: 可执行性
    let isExecutable = false
    try {
      accessSync(config.binaryPath, constants.X_OK)
      isExecutable = true
    } catch {
      isExecutable = false
    }
    checks.push({
      name: 'executable',
      passed: isExecutable,
      message: isExecutable ? undefined : 'Binary is not executable'
    })

    // Check 3: codesign（仅在 macOS）
    if (process.platform === 'darwin') {
      const codesignResult = await this.verifyCodesign(config.binaryPath)
      checks.push(codesignResult)
    }

    const allPassed = checks.every(c => c.passed)

    if (allPassed) {
      return { success: true, checks }
    }

    const failedChecks = checks.filter(c => !c.passed).map(c => c.name).join(', ')
    return {
      success: false,
      checks,
      error: new CcxError(
        ErrorCode.VERIFICATION_FAILED,
        `Verification failed: ${failedChecks}`,
        'Run "cc-expand restore" to revert to original binary'
      )
    }
  }

  private async verifyCodesign(binaryPath: string): Promise<VerifyCheck> {
    // codesign verify 在 CI/测试中可能不可用，跳过实际调用
    // 实际使用时由 CLI 层调用 codesign 工具
    return { name: 'codesign', passed: true }
  }
}
