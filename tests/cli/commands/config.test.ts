/**
 * TDD Slice 1: config command — public interface contract
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { configCommand } from '../../../src/cli/commands/config.js'
import { UserConfigService } from '../../../src/services/user-config.js'

describe('config command', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-config-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    process.env.XDG_CONFIG_HOME = join(tempDir, '.config')
  })

  afterEach(() => {
    process.env.HOME = originalHome
    delete process.env.XDG_CONFIG_HOME
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns default locale as a structured result', async () => {
    const result = await configCommand(['get', 'locale'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('config')
    expect(result.summary).toContain('en')
    expect(result.data).toEqual({ key: 'locale', value: 'en' })
  })

  it('persists a new locale via set', async () => {
    await configCommand(['set', 'locale', 'zh'], {
      userConfigService: new UserConfigService()
    })

    const result = await configCommand(['get', 'locale'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'locale', value: 'zh' })
  })

  it('lang subcommand is a shortcut for locale', async () => {
    const result = await configCommand(['lang', 'zh'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'locale', value: 'zh' })
  })

  it('autoMaintain defaults to true', async () => {
    const result = await configCommand(['get', 'autoMaintain'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'autoMaintain', value: true })
  })

  it('rejects unknown keys with INVALID_TARGET', async () => {
    const result = await configCommand(['get', 'unknownKey'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('rejects invalid locale value via set to prevent downstream t() crash', async () => {
    const result = await configCommand(['set', 'locale', 'fr'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('accepts case-insensitive true variants for autoMaintain', async () => {
    for (const truthy of ['TRUE', 'Yes', '1', 'on']) {
      const result = await configCommand(['set', 'autoMaintain', truthy], {
        userConfigService: new UserConfigService()
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ key: 'autoMaintain', value: true })
    }
  })

  it('accepts false variants for autoMaintain', async () => {
    for (const falsy of ['FALSE', 'no', '0', 'off']) {
      const result = await configCommand(['set', 'autoMaintain', falsy], {
        userConfigService: new UserConfigService()
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ key: 'autoMaintain', value: false })
    }
  })

  it('rejects unrecognized boolean value for autoMaintain', async () => {
    const result = await configCommand(['set', 'autoMaintain', 'maybe'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  // self-update 相关偏好字段（installMethod / autoUpdateCheck / updateCheckInterval）
  // 在 user-config 服务层存在，但历史上 config 命令白名单未同步，导致 self-update
  // 引导用户执行 `ccx config set installMethod` 时被拒（契约分裂）。以下断言守护该契约。

  it('defaults installMethod to unknown', async () => {
    const result = await configCommand(['get', 'installMethod'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'installMethod', value: 'unknown' })
  })

  it('self-update guidance is executable: config set installMethod accepts npm/pnpm/yarn', async () => {
    // self-update 在检测失败时引导：`ccx config set installMethod <npm|pnpm|yarn>`
    // 该断言守护「引导命令必须可执行」契约，防止 config 白名单与引导文本再次分裂
    for (const method of ['npm', 'pnpm', 'yarn']) {
      const result = await configCommand(['set', 'installMethod', method], {
        userConfigService: new UserConfigService()
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ key: 'installMethod', value: method })
    }
  })

  it('rejects invalid installMethod value with INVALID_TARGET', async () => {
    const result = await configCommand(['set', 'installMethod', 'brew'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('persists autoUpdateCheck via set', async () => {
    const result = await configCommand(['set', 'autoUpdateCheck', 'false'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'autoUpdateCheck', value: false })
  })

  it('persists updateCheckInterval via set', async () => {
    const result = await configCommand(['set', 'updateCheckInterval', '3600000'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'updateCheckInterval', value: 3600000 })
  })

  it('rejects non-numeric updateCheckInterval with INVALID_TARGET', async () => {
    const result = await configCommand(['set', 'updateCheckInterval', 'soon'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })

  it('rejects non-positive updateCheckInterval with INVALID_TARGET', async () => {
    const result = await configCommand(['set', 'updateCheckInterval', '0'], {
      userConfigService: new UserConfigService()
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })
})
