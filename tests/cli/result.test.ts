/**
 * TDD Slice A: getExitCode — 错误码到退出码映射契约
 *
 * 验证 self-update 新增的 NETWORK_ERROR / SELF_UPDATE_FAILED
 * 映射到 BSD 风格退出码（69 = EX_UNAVAILABLE，70 = EX_SOFTWARE）。
 */
import { describe, it, expect } from 'vitest'
import { getExitCode } from '../../src/cli/result.js'
import { ErrorCode } from '../../src/types/index.js'

describe('getExitCode', () => {
  it('NETWORK_ERROR 映射到 EX_UNAVAILABLE (69)', () => {
    expect(getExitCode(ErrorCode.NETWORK_ERROR)).toBe(69)
  })

  it('SELF_UPDATE_FAILED 映射到 EX_SOFTWARE (70)', () => {
    expect(getExitCode(ErrorCode.SELF_UPDATE_FAILED)).toBe(70)
  })
})
