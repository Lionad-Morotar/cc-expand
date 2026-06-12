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
      userConfigService: new UserConfigService(),
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe('config')
    expect(result.summary).toContain('en')
    expect(result.data).toEqual({ key: 'locale', value: 'en' })
  })

  it('persists a new locale via set', async () => {
    await configCommand(['set', 'locale', 'zh'], {
      userConfigService: new UserConfigService(),
    })

    const result = await configCommand(['get', 'locale'], {
      userConfigService: new UserConfigService(),
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'locale', value: 'zh' })
  })

  it('lang subcommand is a shortcut for locale', async () => {
    const result = await configCommand(['lang', 'zh'], {
      userConfigService: new UserConfigService(),
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'locale', value: 'zh' })
  })

  it('autoMaintain defaults to true', async () => {
    const result = await configCommand(['get', 'autoMaintain'], {
      userConfigService: new UserConfigService(),
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ key: 'autoMaintain', value: true })
  })

  it('rejects unknown keys with INVALID_TARGET', async () => {
    const result = await configCommand(['get', 'unknownKey'], {
      userConfigService: new UserConfigService(),
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_TARGET')
  })
})
