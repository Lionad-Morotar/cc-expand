/**
 * TDD Slice A: UserConfigService — 公共接口契约
 *
 * 直接测试 load/save/get/set 的外部行为，
 * 聚焦 self-update 新增的 installMethod / autoUpdateCheck / updateCheckInterval 字段。
 * 通过 configPath 依赖注入隔离文件系统，不触碰真实用户配置。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { UserConfigService } from '../../src/services/user-config.js'

describe('UserConfigService', () => {
  let tempDir: string
  let configPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-user-config-'))
    configPath = join(tempDir, 'config.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('load 返回 self-update 新增字段的默认值（全新环境）', () => {
    const service = new UserConfigService({ configPath })
    const prefs = service.load()

    expect(prefs.installMethod).toBe('unknown')
    expect(prefs.autoUpdateCheck).toBe(true)
    expect(prefs.updateCheckInterval).toBe(86400000)
  })

  it('读取不含新字段的旧 config.json 时，新字段填默认值（向后兼容）', () => {
    // 预置旧配置（只有 locale + autoMaintain，模拟升级前用户的 config.json）
    const oldConfig = {
      locale: 'zh',
      autoMaintain: false,
    }
    writeFileSync(configPath, JSON.stringify(oldConfig))

    const service = new UserConfigService({ configPath })
    const prefs = service.load()

    // 旧字段保留用户设置
    expect(prefs.locale).toBe('zh')
    expect(prefs.autoMaintain).toBe(false)
    // 新字段填默认（不因缺失而崩或变成 undefined）
    expect(prefs.installMethod).toBe('unknown')
    expect(prefs.autoUpdateCheck).toBe(true)
    expect(prefs.updateCheckInterval).toBe(86400000)
  })

  it('set 持久化 installMethod 并能通过新实例 get 取回', () => {
    const writer = new UserConfigService({ configPath })
    writer.set('installMethod', 'npm')

    const reader = new UserConfigService({ configPath })
    expect(reader.get('installMethod')).toBe('npm')
  })

  it('set 持久化 autoUpdateCheck', () => {
    const writer = new UserConfigService({ configPath })
    writer.set('autoUpdateCheck', false)

    const reader = new UserConfigService({ configPath })
    expect(reader.get('autoUpdateCheck')).toBe(false)
  })

  it('set 持久化 updateCheckInterval', () => {
    const writer = new UserConfigService({ configPath })
    writer.set('updateCheckInterval', 3600000)

    const reader = new UserConfigService({ configPath })
    expect(reader.get('updateCheckInterval')).toBe(3600000)
  })
})
