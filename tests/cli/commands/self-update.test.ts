/**
 * TDD Slice D: self-update command — 编排层
 *
 * 编排 InstallMethodDetector + spawner + 文案 + 失败处理。
 * 通过依赖注入隔离 detector 和 spawner，绝不在测试中真跑 npm install。
 */
import { describe, it, expect, vi } from 'vitest'
import { selfUpdateCommand } from '../../../src/cli/commands/self-update.js'
import type { InstallMethodDetector } from '../../../src/services/install-method.js'
import type { InstallMethod } from '../../../src/types/index.js'

describe('self-update command', () => {
  function makeDetector(method: InstallMethod): InstallMethodDetector {
    return { detect: vi.fn().mockResolvedValue(method) } as unknown as InstallMethodDetector
  }

  it('installMethod=npm 时用 npm install -g cc-expand@latest', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      spawner,
    })
    expect(spawner).toHaveBeenCalledWith('npm', ['install', '-g', 'cc-expand@latest'])
    expect(result.success).toBe(true)
  })

  it('installMethod=pnpm 时用 pnpm add -g cc-expand@latest', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    await selfUpdateCommand({
      installMethodDetector: makeDetector('pnpm'),
      spawner,
    })
    expect(spawner).toHaveBeenCalledWith('pnpm', ['add', '-g', 'cc-expand@latest'])
  })

  it('installMethod=yarn 时用 yarn global add cc-expand', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 0 })
    await selfUpdateCommand({
      installMethodDetector: makeDetector('yarn'),
      spawner,
    })
    expect(spawner).toHaveBeenCalledWith('yarn', ['global', 'add', 'cc-expand'])
  })

  it('installMethod=npx 时不调 spawner，返回成功提示', async () => {
    const spawner = vi.fn()
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npx'),
      spawner,
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
    })
    expect(spawner).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
  })

  it('spawner 返回非零退出码时返回 SELF_UPDATE_FAILED', async () => {
    const spawner = vi.fn().mockResolvedValue({ code: 1 })
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      spawner,
    })
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
  })

  it('spawner 抛 EACCES 时 suggestion 含 prefix 配置建议', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const spawner = vi.fn().mockRejectedValue(error)
    const result = await selfUpdateCommand({
      installMethodDetector: makeDetector('npm'),
      spawner,
    })
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SELF_UPDATE_FAILED')
    expect(result.error?.suggestion).toMatch(/prefix|sudo/i)
  })
})
