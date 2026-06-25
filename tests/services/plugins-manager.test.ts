import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { PluginsManager } from '../../src/services/plugins-manager.js'
import type { InternalPluginDefinition, PluginManifest } from '../../src/types/plugins.js'

function fakeInternal(): InternalPluginDefinition {
  return {
    manifest: {
      name: 'token-expansion',
      shardBaseUrl: 'https://x/',
      shortVer: { kind: 'token-target' },
    },
    strategies: {},
  }
}

function flowManifest(): PluginManifest {
  return {
    name: 'flow',
    shardBaseUrl: 'https://y/',
    shortVer: { kind: 'literal', value: 'flow' },
  }
}

/** 每个测试独立 homeDir，注册表互不污染 */
function newPm(internalPlugins: InternalPluginDefinition[] = [fakeInternal()]) {
  const homeDir = mkdtempSync(join(tmpdir(), 'ccx-pm-'))
  return { homeDir, pm: new PluginsManager({ internalPlugins, homeDir }) }
}

describe('PluginsManager', () => {
  it('list() includes internal plugins even with empty registry', () => {
    const { pm } = newPm()
    expect(pm.list().map(p => p.name)).toEqual(['token-expansion'])
  })

  it('add() persists installed plugin; list() shows internal then installed', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    const list = pm.list()
    expect(list.map(p => p.name)).toEqual(['token-expansion', 'flow'])
    expect(list.map(p => p.source)).toEqual(['internal', 'installed'])
  })

  it('ordered() returns enabled only, internal first then installed by addTime', () => {
    const { pm } = newPm()
    pm.add({ name: 'a', shardBaseUrl: 'https://a/', shortVer: { kind: 'literal', value: 'a' } })
    pm.add({ name: 'b', shardBaseUrl: 'https://b/', shortVer: { kind: 'literal', value: 'b' } })
    expect(pm.ordered().map(p => p.name)).toEqual(['token-expansion', 'a', 'b'])
  })

  it('add() is idempotent (same name not duplicated)', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    pm.add(flowManifest())
    expect(pm.list().filter(p => p.name === 'flow').length).toBe(1)
  })

  it('disable() excludes from ordered(); works for internal and installed', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    pm.disable('token-expansion')
    pm.disable('flow')
    expect(pm.ordered().map(p => p.name)).toEqual([])
    // list() 仍含两者，但 enabled:false
    const list = pm.list()
    expect(list.find(p => p.name === 'token-expansion')?.enabled).toBe(false)
    expect(list.find(p => p.name === 'flow')?.enabled).toBe(false)
  })

  it('enable() restores into ordered()', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    pm.disable('flow')
    pm.enable('flow')
    expect(pm.ordered().map(p => p.name)).toEqual(['token-expansion', 'flow'])
  })

  it('remove() drops installed plugin; internal not removable', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    pm.remove('flow')
    expect(pm.list().map(p => p.name)).toEqual(['token-expansion'])
    expect(() => pm.remove('token-expansion')).toThrow()
  })

  it('isInstalled/isEnabled/get reflect state', () => {
    const { pm } = newPm()
    pm.add(flowManifest())
    expect(pm.isInstalled('flow')).toBe(true)
    expect(pm.isInstalled('token-expansion')).toBe(false) // internal 不算 installed
    expect(pm.isEnabled('flow')).toBe(true)
    expect(pm.isEnabled('token-expansion')).toBe(true)
    expect(pm.get('flow')?.source).toBe('installed')
    expect(pm.get('token-expansion')?.source).toBe('internal')
    expect(pm.get('missing')).toBeUndefined()
  })

  it('computeShortVer() joins each enabled plugin shortVer with -', () => {
    const internal: InternalPluginDefinition = {
      manifest: { name: 'token-expansion', shardBaseUrl: 'x', shortVer: { kind: 'token-target' } },
      strategies: { shortVer: (ctx) => `mock-${ctx.targetTokens}` },
    }
    const { pm } = newPm([internal])
    pm.add({ name: 'flow', shardBaseUrl: 'y', shortVer: { kind: 'literal', value: 'flow' } })
    expect(pm.computeShortVer({ targetTokens: 270000 })).toBe('mock-270000-flow')
  })

  it('computeShortVer() skips disabled plugins', () => {
    const internal: InternalPluginDefinition = {
      manifest: { name: 'token-expansion', shardBaseUrl: 'x', shortVer: { kind: 'token-target' } },
      strategies: { shortVer: (ctx) => `mock-${ctx.targetTokens}` },
    }
    const { pm } = newPm([internal])
    pm.add({ name: 'flow', shardBaseUrl: 'y', shortVer: { kind: 'literal', value: 'flow' } })
    pm.disable('flow')
    expect(pm.computeShortVer({ targetTokens: 270000 })).toBe('mock-270000')
  })

  it('add() upserts manifest on re-add, returns added/updated (flow review 3)', () => {
    const { pm } = newPm()
    expect(pm.add(flowManifest())).toBe('added')
    // 再 add 改了 shardBaseUrl 的同名 → 更新 manifest，保留 enabled，仍只一条记录
    const updated = { ...flowManifest(), shardBaseUrl: 'https://z/' }
    expect(pm.add(updated)).toBe('updated')
    expect(pm.list().filter(p => p.name === 'flow').length).toBe(1)
    expect(pm.get('flow')?.manifest.shardBaseUrl).toBe('https://z/')
    expect(pm.isEnabled('flow')).toBe(true)
  })

  it('add() rejects name conflicting with internal plugin (flow review 5)', () => {
    const { pm } = newPm()
    const r = pm.add({ ...flowManifest(), name: 'token-expansion' })
    expect(r).toBe('conflict')
    expect(pm.isInstalled('token-expansion')).toBe(false) // 未写入注册表
  })

  it('disable/enable throws on unknown plugin (flow review CR#6)', () => {
    const { pm } = newPm()
    expect(() => pm.disable('nonexistent')).toThrow()
    expect(() => pm.enable('nonexistent')).toThrow()
  })
})
