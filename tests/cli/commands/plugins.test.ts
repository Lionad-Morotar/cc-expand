import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { pluginsCommand } from '../../../src/cli/commands/plugins.js'
import { PluginsManager } from '../../../src/services/plugins-manager.js'
import { ErrorCode } from '../../../src/types/index.js'
import type { InternalPluginDefinition } from '../../../src/types/plugins.js'

const fakeInternal: InternalPluginDefinition = {
  manifest: { name: 'token-expansion', shardBaseUrl: 'https://x/', shortVer: { kind: 'token-target' } },
  strategies: {}
}

function newHome(): string {
  return mkdtempSync(join(tmpdir(), 'ccx-pcmd-'))
}

function opts(home: string) {
  return { internalPlugins: [fakeInternal], homeDir: home }
}

describe('pluginsCommand', () => {
  it('list returns internal plugins', async () => {
    const r = await pluginsCommand(['list'], opts(newHome()))
    expect(r.success).toBe(true)
    expect(r.data?.plugins.map(p => p.name)).toEqual(['token-expansion'])
  })

  it('disable then enable internal plugin (persists across commands)', async () => {
    const home = newHome()
    const o = opts(home)
    await pluginsCommand(['disable', 'token-expansion'], o)
    const afterDisable = await pluginsCommand(['list'], o)
    expect(afterDisable.data?.plugins.find(p => p.name === 'token-expansion')?.enabled).toBe(false)

    await pluginsCommand(['enable', 'token-expansion'], o)
    const afterEnable = await pluginsCommand(['list'], o)
    expect(afterEnable.data?.plugins.find(p => p.name === 'token-expansion')?.enabled).toBe(true)
  })

  it('remove installed plugin', async () => {
    const home = newHome()
    const o = opts(home)
    // 预置 installed（add 尚未实现，用 PluginsManager 直接 add）
    new PluginsManager({ internalPlugins: [fakeInternal], homeDir: home }).add({
      name: 'flow', shardBaseUrl: 'https://y/', shortVer: { kind: 'literal', value: 'flow' }
    })
    const r = await pluginsCommand(['remove', 'flow'], o)
    expect(r.success).toBe(true)
    const list = await pluginsCommand(['list'], o)
    expect(list.data?.plugins.map(p => p.name)).not.toContain('flow')
  })

  it('remove internal plugin errors (not removable)', async () => {
    const r = await pluginsCommand(['remove', 'token-expansion'], opts(newHome()))
    expect(r.success).toBe(false)
    expect(r.error?.code).toBe(ErrorCode.INVALID_TARGET)
  })

  it('no subcommand errors with usage hint', async () => {
    const r = await pluginsCommand([], opts(newHome()))
    expect(r.success).toBe(false)
    expect(r.error?.suggestion).toMatch(/Usage/)
  })

  it('enable without name errors', async () => {
    const r = await pluginsCommand(['enable'], opts(newHome()))
    expect(r.success).toBe(false)
  })

  it('add fetches ccx-plugins.json and registers (with --yes)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [{ name: 'flow', shardBaseUrl: 'https://y/', shortVer: { kind: 'literal', value: 'flow' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const r = await pluginsCommand(['add', 'owner/repo'], { internalPlugins: [fakeInternal], homeDir: newHome(), yes: true })
      expect(r.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('https://raw.githubusercontent.com/owner/repo/main/ccx-plugins.json')
      expect(r.summary).toMatch(/installed flow/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('add filters by --plugin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [
        { name: 'a', shardBaseUrl: 'https://x/', shortVer: { kind: 'literal', value: 'a' } },
        { name: 'b', shardBaseUrl: 'https://y/', shortVer: { kind: 'literal', value: 'b' } }
      ] })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const r = await pluginsCommand(['add', 'owner/repo'], { internalPlugins: [fakeInternal], homeDir: newHome(), plugin: ['a'], yes: true })
      expect(r.success).toBe(true)
      expect(r.summary).toMatch(/installed a$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('add skips invalid manifests at install entry (flow review 4)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [
        { name: 'valid', shardBaseUrl: 'https://v/', shortVer: { kind: 'literal', value: 'v' } },
        { name: 'BAD-NAME', shardBaseUrl: 'https://v/', shortVer: { kind: 'literal', value: 'v' } }, // 非法 name（非 kebab-case）
        { name: 'nourl', shardBaseUrl: 'not-a-url', shortVer: { kind: 'literal', value: 'n' } }, // 非法 shardBaseUrl
        { name: 'noshortver', shardBaseUrl: 'https://v/' } // 缺 shortVer
      ] })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const r = await pluginsCommand(['add', 'owner/repo'], { internalPlugins: [fakeInternal], homeDir: newHome(), yes: true })
      expect(r.success).toBe(true)
      expect(r.summary).toMatch(/installed valid/)
      // 非法 manifest 不应出现在结果里
      expect(r.summary).not.toMatch(/BAD-NAME|nourl|noshortver/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('add errors on invalid repo (no slash)', async () => {
    const r = await pluginsCommand(['add', 'no-slash'], opts(newHome()))
    expect(r.success).toBe(false)
  })

  it('unknown subcommand errors', async () => {
    const r = await pluginsCommand(['frobnicate', 'x'], opts(newHome()))
    expect(r.success).toBe(false)
  })
})
