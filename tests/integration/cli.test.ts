import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

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
