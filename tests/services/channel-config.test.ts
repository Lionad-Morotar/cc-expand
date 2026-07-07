import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChannelConfig } from '../../src/services/channel-config.js'

describe('ChannelConfig', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-channel-config-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should return undefined when no channel is set', () => {
    const config = new ChannelConfig(tempDir)
    expect(config.hasChannel()).toBe(false)
    expect(config.getChannel()).toBeUndefined()
  })

  it('should save and read channel config', () => {
    const config = new ChannelConfig(tempDir)
    config.saveChannel({
      channel: 'brew',
      path: '/opt/homebrew/bin/claude',
      version: '2.1.170'
    })

    expect(config.hasChannel()).toBe(true)
    const saved = config.getChannel()
    expect(saved).toEqual({
      channel: 'brew',
      path: '/opt/homebrew/bin/claude',
      version: '2.1.170'
    })
  })

  it('should clear channel config', () => {
    const config = new ChannelConfig(tempDir)
    config.saveChannel({
      channel: 'npx',
      path: '/home/user/.npm/_npx/abc123/node_modules/@anthropic-ai/claude-code/bin/claude',
      version: '2.1.169'
    })

    expect(config.hasChannel()).toBe(true)
    config.clearChannel()
    expect(config.hasChannel()).toBe(false)
  })
})
