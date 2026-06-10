import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CLI_PATH = join(__dirname, '..', '..', 'dist', 'cli.js')

describe('CLI Integration', () => {
  it('should show help for --help flag', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('cc-expand')
    expect(output).toContain('patch')
    expect(output).toContain('restore')
    expect(output).toContain('verify')
  })

  it('should show help when no command given', () => {
    const output = execFileSync('node', [CLI_PATH], {
      encoding: 'utf-8',
    })

    expect(output).toContain('cc-expand')
  })

  it('should error when --yes is used without --target', () => {
    let threw = false
    try {
      execFileSync('node', [CLI_PATH, 'patch', '--yes'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: any) {
      threw = true
      const combined = (error.stdout || '') + (error.stderr || '')
      expect(combined).toContain('--yes requires --target')
      expect(error.status).toBe(1)
    }
    expect(threw).toBe(true)
  })

  it('should error for unknown command', () => {
    let threw = false
    try {
      execFileSync('node', [CLI_PATH, 'unknown'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: any) {
      threw = true
      const combined = (error.stdout || '') + (error.stderr || '')
      expect(combined).toContain('Unknown command')
      expect(error.status).toBe(1)
    }
    expect(threw).toBe(true)
  })

  it('should append cc function to zshrc with --yes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const env = { ...process.env, HOME: tempDir }
    execFileSync('node', [CLI_PATH, 'setup', '--yes'], {
      encoding: 'utf-8',
      env,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 270000'")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should backup existing cc function and alias in zshrc', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, `existing config\ncc() { echo old; }\nalias c='oldcmd'\n`)

    const env = { ...process.env, HOME: tempDir }
    execFileSync('node', [CLI_PATH, 'setup', '--yes'], {
      encoding: 'utf-8',
      env,
    })

    const content = readFileSync(zshrc, 'utf-8')
    // 旧定义被备份
    expect(content).toContain('cc_backup()')
    expect(content).toContain('alias c_backup=')
    // 新定义存在
    expect(content).toContain("alias c='cc 270000'")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should error when cc-expand block already exists', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))
    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# --- cc-expand generated start ---\ncc() {}\n# --- cc-expand generated end ---\n')

    const env = { ...process.env, HOME: tempDir }
    let threw = false
    try {
      execFileSync('node', [CLI_PATH, 'setup', '--yes'], {
        encoding: 'utf-8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: any) {
      threw = true
      const combined = (error.stdout || '') + (error.stderr || '')
      expect(combined).toContain('already installed')
    }
    expect(threw).toBe(true)

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should list supported versions', () => {
    const output = execFileSync('node', [CLI_PATH, 'supports'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('Supported versions:')
    expect(output).toContain('2.1.161')
    expect(output).toContain('2.1.170')
  })

  // Note: status command requires a working Claude Code binary with responsive --version
  // This test is skipped in CI where claude may not be available or may hang
  it.skip('should show status with found binary (requires working claude binary)', () => {
    const output = execFileSync('node', [CLI_PATH, 'status'], {
      encoding: 'utf-8',
      timeout: 10000,
    })

    expect(output).toContain('Binary:')
    expect(output).toContain('Version:')
    expect(output).toMatch(/Status: (Patched|Unpatched)/)
  })
})
