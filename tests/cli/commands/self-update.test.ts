/**
 * TDD Slice D + G: self-update command — 编排层
 *
 * 编排 InstallMethodDetector + UpdateCheckService + spawner。
 * 手动执行强制查最新版（skipCache）：已是最新跳过 spawn，有更新显示 from→to，
 * 查询失败降级 spawn。通过依赖注入隔离所有外部依赖。
 */
import { describe, it, expect, vi } from 'vitest'
import { selfUpdateCommand } from '../../../src/cli/commands/self-update.js'
import type { InstallMethodDetector } from '../../../src/services/install-method.js'
import type { InstallMethod } from '../../../src/types/index.js'

describe('self-update command', () => {
  function makeDetector(method: InstallMethod): InstallMethodDetector {
    return { detect: vi.fn().mockResolvedValue(method) } as unknown as InstallMethodDetector
  }

  function makeUpdateCheck(hasUpdate: boolean, latest = '0.3.1') {
    return {
      check: vi.fn().mockResolvedValue({
        hasUpdate,
        currentVersion: '0.3.0',
        latestVersion: latest,
      }),
    }
  }

  it('installMethod=npm 时用 npm install -g cc-expand@latest', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: makeUpdateCheck(true),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).toHaveBeenCalledWith('npm', ['install', '-g', 'cc-expand@latest'])
    expect(result.success).toBe(true)
  })

  it('installMethod=pnpm 时用 pnpm add -g cc-expand@latest', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    await selfUpdateCommand({
      installMethodDetector: makeDetector('pnpm'),
      updateCheckService: makeUpdateCheck(true),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).toHaveBeenCalledWith('pnpm', ['add', '-g', 'cc-expand@latest'])
  })

  it('installMethod=yarn 时用 yarn global add cc-expand', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    await selfUpdateCommand({
      installMethodDetector: makeDetector('yarn'),
      updateCheckService: makeUpdateCheck(true),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).toHaveBeenCalledWith('yarn', ['global', 'add', 'cc-expand'])
  })

  it('installMethod=npx 时不调 spawner，返回成功提示', async () => {
    const spawner = vi.fn()
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npx'),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.summary).toMatch(/npx/i)
  })

  it('installMethod=unknown 时返回 SELF_UPDATE_FAILED 错误', async () => {
    const spawner = vi.fn()
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('unknown'),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
  })

  it('已是最新版时跳过 spawn，提示已是最新版本', async () => {
    const spawner = vi.fn()
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: makeUpdateCheck(false, '0.3.0'),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.summary).toMatch(/up to date|最新/i)
  })

  it('有更新时显示 from→to 版本号', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: makeUpdateCheck(true, '0.3.1'),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(result.success).toBe(true)
    expect(result.summary).toContain('0.3.0')
    expect(result.summary).toContain('0.3.1')
  })

  it('版本查询失败时降级直接 spawn（用户意图明确，不因查询失败阻止）', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: { check: vi.fn().mockResolvedValue(null) },
      spawner,
      currentVersion: '0.3.0',
    })
    expect(spawner).toHaveBeenCalled()
    expect(result.success).toBe(true)
  })

  it('spawner 返回非零退出码时返回 SELF_UPDATE_FAILED', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 1 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: makeUpdateCheck(true),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
  })

  it('spawner 抛 EACCES 时 suggestion 含 prefix 配置建议', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const spawner = vi.fn().mockRejectedValue(error)
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      updateCheckService: makeUpdateCheck(true),
      spawner,
      currentVersion: '0.3.0',
    })
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
    expect(result.error?.suggestion).toMatch(/prefix|sudo/i)
  })
})
