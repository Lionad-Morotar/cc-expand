/**
 * TDD Slice E: update-check-runner — 隐式更新检查运行器
 *
 * 封装"是否检查"判断与"await + 打印提示"逻辑，从 cli/index.ts 抽出便于测试。
 * hintWriter 依赖注入，避免直接耦合 console.error。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  shouldRunUpdateCheck,
  awaitUpdateCheckHint
} from '../../src/cli/update-check-runner.js'
import type { UserConfigService } from '../../src/services/user-config.js'

describe('shouldRunUpdateCheck', () => {
  function makeConfig(autoUpdateCheck: boolean): Pick<UserConfigService, 'get'> {
    return { get: vi.fn().mockReturnValue(autoUpdateCheck) }
  }

  it('status 命令 + autoUpdateCheck=true → true', () => {
    expect(shouldRunUpdateCheck('status', makeConfig(true))).toBe(true)
  })

  it('run 命令 → false（即使 autoUpdateCheck=true，避免拖慢启动）', () => {
    expect(shouldRunUpdateCheck('run', makeConfig(true))).toBe(false)
  })

  it('self-update 命令 → false（本身就是更新入口，避免自相矛盾的"有更新"提示）', () => {
    expect(shouldRunUpdateCheck('self-update', makeConfig(true))).toBe(false)
  })

  it('autoUpdateCheck=false → false', () => {
    expect(shouldRunUpdateCheck('status', makeConfig(false))).toBe(false)
  })

  it('commandName 为空 → false', () => {
    expect(shouldRunUpdateCheck(undefined, makeConfig(true))).toBe(false)
  })
})

describe('awaitUpdateCheckHint', () => {
  it('hasUpdate=true 时调用 hintWriter，提示含版本号和 self-update 命令', async () => {
    const hintWriter = vi.fn()
    const promise = Promise.resolve({
      hasUpdate: true,
      currentVersion: '0.3.0',
      latestVersion: '0.3.1'
    })
    await awaitUpdateCheckHint(promise, hintWriter)
    expect(hintWriter).toHaveBeenCalledOnce()
    expect(hintWriter).toHaveBeenCalledWith(expect.stringContaining('0.3.0'))
    expect(hintWriter).toHaveBeenCalledWith(expect.stringContaining('0.3.1'))
    expect(hintWriter).toHaveBeenCalledWith(expect.stringContaining('self-update'))
  })

  it('hasUpdate=false 时不调用 hintWriter', async () => {
    const hintWriter = vi.fn()
    const promise = Promise.resolve({
      hasUpdate: false,
      currentVersion: '0.3.0',
      latestVersion: '0.3.0'
    })
    await awaitUpdateCheckHint(promise, hintWriter)
    expect(hintWriter).not.toHaveBeenCalled()
  })

  it('检查返回 null（失败）时不调用 hintWriter', async () => {
    const hintWriter = vi.fn()
    await awaitUpdateCheckHint(Promise.resolve(null), hintWriter)
    expect(hintWriter).not.toHaveBeenCalled()
  })

  it('检查超时时不调用 hintWriter（避免阻塞用户）', async () => {
    const hintWriter = vi.fn()
    const slowPromise = new Promise<null>(() => {}) // 永不 resolve
    await awaitUpdateCheckHint(slowPromise, hintWriter, 10)
    expect(hintWriter).not.toHaveBeenCalled()
  })
})
