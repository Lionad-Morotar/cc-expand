import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const INSTALL_JS = join(__dirname, '..', '..', 'install.js')
const ZSHRC = join(homedir(), '.zshrc')

describe('install.js', () => {
  it('should show help for --help flag', () => {
    const output = execFileSync('node', [INSTALL_JS, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('Usage: node install.js')
    expect(output).toContain('--target')
    expect(output).toContain('--version')
  })

  it('should fail fast for unsupported version', () => {
    let threw = false
    let combined = ''
    try {
      execFileSync('node', [INSTALL_JS, '--version', '2.1.156'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: any) {
      threw = true
      combined = (error.stdout || '') + (error.stderr || '')
    }

    expect(threw).toBe(true)
    expect(combined).toMatch(/not supported|unsupported/i)
  })

  it('should complete full setup for supported version', () => {
    // Save and restore ~/.zshrc to avoid side effects
    const originalZshrc = existsSync(ZSHRC) ? readFileSync(ZSHRC, 'utf-8') : ''
    const cleanedZshrc = originalZshrc.replace(/# --- cc-expand generated start ---[\s\S]*?# --- cc-expand generated end ---\n?/g, '')
    writeFileSync(ZSHRC, cleanedZshrc)

    // Pre-create valid config to avoid recordPatchedVersion bug in global v0.0.1
    const configDir = join(homedir(), '.cc-expand')
    const versionsJson = join(configDir, 'versions.json')
    writeFileSync(versionsJson, '{"patchedVersions": {}}', { flag: 'w' })

    try {
      const output = execFileSync('node', [INSTALL_JS, '--version', '2.1.170', '--target', '270000'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000, // 5 minutes for npm install + download
        env: { ...process.env, CC_EXPAND_SETUP: '1' },
      })

      expect(output).toContain('Done!')
      expect(output).toContain('270000')

      // Verify shell integration was added
      const newZshrc = readFileSync(ZSHRC, 'utf-8')
      expect(newZshrc).toContain('cc-expand generated')
    } finally {
      writeFileSync(ZSHRC, originalZshrc)
    }
  })
})
