import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChannelDiscoveryService, type ChannelInfo } from '../../src/services/channel.js'

describe('ChannelDiscoveryService', () => {
  let tempDir: string
  let originalPath: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-channel-'))
    originalPath = process.env.PATH
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    if (originalPath !== undefined) {
      process.env.PATH = originalPath
    }
  })

  it('should detect direct channel from PATH', async () => {
    const fakeBinDir = join(tempDir, 'bin')
    mkdirSync(fakeBinDir, { recursive: true })
    const fakeClaude = join(fakeBinDir, 'claude')
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.170 (Claude Code)"')
    chmodSync(fakeClaude, 0o755)
    process.env.PATH = `${fakeBinDir}${process.platform === 'win32' ? ';' : ':'}${originalPath}`

    const service = new ChannelDiscoveryService()
    const channels = await service.detectChannels()

    expect(channels.length).toBeGreaterThan(0)
    const direct = channels.find((c: ChannelInfo) => c.name === 'direct')
    expect(direct).toBeDefined()
    expect(direct?.path).toBe(fakeClaude)
    expect(direct?.version).toBe('2.1.170')
    expect(direct?.isInPath).toBe(true)
  })

  it('should detect npx channel', async () => {
    // Arrange: create fake NPX cache
    const fakeNpxDir = join(tempDir, 'npx', 'abc123')
    mkdirSync(fakeNpxDir, { recursive: true })
    const fakeClaude = join(
      fakeNpxDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude'
    )
    mkdirSync(join(fakeNpxDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), {
      recursive: true
    })
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.169 (Claude Code)"')
    chmodSync(fakeClaude, 0o755)

    // Clear PATH so the real claude is not found
    process.env.PATH = tempDir

    const service = new ChannelDiscoveryService({
      npxCacheDirs: [join(tempDir, 'npx')]
    })

    // Act
    const channels = await service.detectChannels()

    // Assert
    const npx = channels.find((c: ChannelInfo) => c.name === 'npx')
    expect(npx).toBeDefined()
    expect(npx?.path).toBe(fakeClaude)
    expect(npx?.version).toBe('2.1.169')
    expect(npx?.isInPath).toBe(false)
  })

  it('should detect brew channel from PATH', async () => {
    const fakeBrewDir = join(tempDir, 'homebrew', 'bin')
    mkdirSync(fakeBrewDir, { recursive: true })
    const fakeClaude = join(fakeBrewDir, 'claude')
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.168 (Claude Code)"')
    chmodSync(fakeClaude, 0o755)

    process.env.PATH = fakeBrewDir

    const service = new ChannelDiscoveryService()
    const channels = await service.detectChannels()

    const brew = channels.find((c: ChannelInfo) => c.name === 'brew')
    expect(brew).toBeDefined()
    expect(brew?.path).toBe(fakeClaude)
    expect(brew?.version).toBe('2.1.168')
    expect(brew?.isInPath).toBe(true)
  })

  it('should sort channels by priority (brew > npx > direct)', async () => {
    // Create brew + npx + direct simultaneously
    const fakeBrewDir = join(tempDir, 'homebrew', 'bin')
    mkdirSync(fakeBrewDir, { recursive: true })
    const brewClaude = join(fakeBrewDir, 'claude')
    writeFileSync(brewClaude, '#!/bin/bash\necho "2.1.168"')
    chmodSync(brewClaude, 0o755)

    const fakeNpxDir = join(tempDir, 'npx', 'abc123')
    mkdirSync(fakeNpxDir, { recursive: true })
    const npxClaude = join(fakeNpxDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude')
    mkdirSync(join(fakeNpxDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), { recursive: true })
    writeFileSync(npxClaude, '#!/bin/bash\necho "2.1.169"')
    chmodSync(npxClaude, 0o755)

    // Only brew in PATH, npx off-path
    process.env.PATH = fakeBrewDir

    const service = new ChannelDiscoveryService({
      npxCacheDirs: [join(tempDir, 'npx')]
    })
    const channels = await service.detectChannels()

    expect(channels[0].name).toBe('brew')
    expect(channels[1].name).toBe('npx')
  })
})
