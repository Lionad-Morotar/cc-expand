import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { PatchEngine } from '../../src/core/patch-engine.js'
import { PluginsManager } from '../../src/services/plugins-manager.js'
import { getPatchedBinaryName } from '../../src/services/patch-applier.js'
import { encodeTokenLiteral } from '@cc-expand/plugin-context-expand'

describe('plugin patch 端到端（抽象验证）', () => {
  it('混合 token + installed literal patches → 替换 + claude-27w-flow 命名', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'ccx-e2e-'))
    // token internal：shortVer 模拟 formatTokenCount（270000 → '27w'）
    const tokenInternal = {
      manifest: { name: 'token-expansion', shardBaseUrl: 'https://x/', shortVer: { kind: 'token-target' } },
      strategies: { shortVer: () => '27w' }
    }
    const pm = new PluginsManager({ internalPlugins: [tokenInternal], homeDir })
    pm.add({
      name: 'cc-flow',
      shardBaseUrl: 'https://flow/',
      shortVer: { kind: 'literal', value: 'flow' }
    })

    // buffer 含 token 常量（200000，6B 槽位）+ cc-flow 降权字符串（30B 槽位）
    const ccflowSlot = 'A'.repeat(30)
    const buffer = Buffer.from('Aj8=200000,Ij_=20000' + '___' + ccflowSlot)
    const patches = [
      { search: 'Aj8=200000,Ij_=20000', sourceValue: '200000', desc: 'token' },
      { search: ccflowSlot, sourceValue: ccflowSlot, target: { value: 'process.env.X?"":x', pad: 'right-space' as const } }
    ]

    const result = new PatchEngine().patch(buffer, patches, (slot: number) => encodeTokenLiteral(270000, slot))
    expect(result.success).toBe(true)
    expect(result.replaceCount).toBe(2)

    // shortVer 命名：token(27w) + cc-flow(flow) → 27w-flow
    const shortVer = pm.computeShortVer({ targetTokens: 270000 })
    expect(shortVer).toBe('27w-flow')
    expect(getPatchedBinaryName(shortVer)).toBe('claude-27w-flow')

    // buffer 替换验证
    const mutated = buffer.toString('utf-8')
    expect(mutated).toContain('270000') // token 常量替换（encodeTokenLiteral 270000→'270000'）
    expect(mutated).toContain('process.env.X?"":x') // cc-flow literal value
    expect(mutated).not.toContain('200000')
    expect(mutated).not.toContain(ccflowSlot)
  })

  it('disabled installed plugin 不参与 shortVer 命名', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'ccx-e2e-'))
    const tokenInternal = {
      manifest: { name: 'token-expansion', shardBaseUrl: 'https://x/', shortVer: { kind: 'token-target' } },
      strategies: { shortVer: () => '27w' }
    }
    const pm = new PluginsManager({ internalPlugins: [tokenInternal], homeDir })
    pm.add({ name: 'cc-flow', shardBaseUrl: 'https://flow/', shortVer: { kind: 'literal', value: 'flow' } })
    pm.disable('cc-flow')
    expect(pm.computeShortVer({ targetTokens: 270000 })).toBe('27w')
  })
})
