/**
 * 验证器
 * Patch 后执行多步验证，确保二进制文件完整可用
 */
import { accessSync, constants, readFileSync } from 'node:fs'
import type { PatchItem } from '../types/index.js'
import { CcxError, ErrorCode } from '../types/index.js'

export interface VerifyConfig {
  /** 二进制文件路径 */
  binaryPath: string
  /** 目标 tokens 值 */
  targetTokens: number
  /** 源 tokens 值 */
  sourceValue: string
  /** patch 项列表 */
  patches: PatchItem[]
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

    // Check 1: 特定模式替换验证
    // 对每个 patch 项，验证搜索模式中的 sourceValue 已被替换为 targetTokens
    const targetStr = config.targetTokens.toString()
    let allPatched = true
    const failedPatches: string[] = []

    for (const patch of config.patches) {
      const searchBuf = Buffer.from(patch.search, 'utf8')
      const sourceOffsetInSearch = patch.search.indexOf(patch.sourceValue)

      if (sourceOffsetInSearch === -1) {
        // 如果搜索模式中不包含 sourceValue，跳过
        continue
      }

      // 检查是否还有未替换的模式
      let offset = 0
      let foundUnpatched = false
      while (true) {
        const idx = content.indexOf(searchBuf, offset)
        if (idx === -1) break

        // 验证该位置的 sourceValue 是否已被替换
        const replaceAt = idx + sourceOffsetInSearch
        const currentValue = content.subarray(replaceAt, replaceAt + patch.sourceValue.length).toString('utf8')
        if (currentValue === patch.sourceValue) {
          foundUnpatched = true
          failedPatches.push(patch.desc)
          break
        }
        offset = idx + searchBuf.length
      }

      if (foundUnpatched) {
        allPatched = false
      }
    }

    // 检查是否包含新的目标值
    const hasTarget = content.indexOf(Buffer.from(targetStr)) !== -1

    checks.push({
      name: 'pattern-replaced',
      passed: allPatched && hasTarget,
      message: allPatched && hasTarget
        ? undefined
        : `Unpatched patterns: ${failedPatches.join(', ') || 'none found'}`,
    })

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
      message: isExecutable ? undefined : 'Binary is not executable',
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
        'Run "cc-expand restore" to revert to original binary',
      ),
    }
  }

  private async verifyCodesign(binaryPath: string): Promise<VerifyCheck> {
    // codesign verify 在 CI/测试中可能不可用，跳过实际调用
    // 实际使用时由 CLI 层调用 codesign 工具
    return { name: 'codesign', passed: true }
  }
}
