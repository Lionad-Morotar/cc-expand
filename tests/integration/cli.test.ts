import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CLI_PATH = join(__dirname, '..', '..', 'dist', 'cli.js')

describe('CLI Integration', () => {
  it('should show help for --help flag', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('ccx')
    expect(output).toContain('patch')
    expect(output).toContain('restore')
    expect(output).toContain('verify')
  })

  it('should show version for --version flag', () => {
    const pkgPath = join(__dirname, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

    const output = execFileSync('node', [CLI_PATH, '--version'], {
      encoding: 'utf-8',
    })

    expect(output.trim()).toContain(pkg.version)
  })

  it('should error when no command given', () => {
    let threw = false
    try {
      execFileSync('node', [CLI_PATH], {
        encoding: 'utf-8',
      })
    } catch (error: any) {
      threw = true
      const combined = (error.stdout || '') + (error.stderr || '')
      expect(combined).toContain('No command specified')
      expect(error.status).toBe(64)
    }
    expect(threw).toBe(true)
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
      expect(error.status).toBe(64)
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
      expect(error.status).toBe(64)
    }
    expect(threw).toBe(true)
  })

  it('patch help explains the remove action and shows examples', () => {
    const output = execFileSync('node', [CLI_PATH, '--locale', 'en', 'patch', '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('ccx patch remove <version> [combo]')
    expect(output).toContain('Examples:')
    expect(output).toContain('$ ccx patch 2.1.186 --target 270000')
    expect(output).toContain('$ ccx patch remove 2.1.186 27w')
  })

  it('config help lists subcommands and shows examples', () => {
    const output = execFileSync('node', [CLI_PATH, '--locale', 'en', 'config', '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('ccx config <get|set|lang> [key] [value]')
    expect(output).toContain('Examples:')
    expect(output).toContain('$ ccx config get locale')
    expect(output).toContain('$ ccx config set locale zh')
  })

  it('run help uses combo terminology and shows examples', () => {
    const output = execFileSync('node', [CLI_PATH, '--locale', 'en', 'run', '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('ccx run [combo]')
    expect(output).toContain('Examples:')
    expect(output).toContain('$ ccx run')
    expect(output).toContain('$ ccx run 27w-flow')
  })

  it('migration help mentions latest and shows examples', () => {
    const output = execFileSync('node', [CLI_PATH, '--locale', 'en', 'migration', '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('ccx migration [version|latest]')
    expect(output).toContain('Examples:')
    expect(output).toContain('$ ccx migration latest')
  })

  it('shows English help by default when no locale preference exists', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-locale-help-'))
    const env = { ...process.env, HOME: tempDir, XDG_CONFIG_HOME: join(tempDir, '.config') }

    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
      env,
    })

    expect(output).toContain('Usage:')
    expect(output).toContain('Commands:')
    expect(output).toContain('Options:')
    expect(output).toContain('Manage user preferences')

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('shows Chinese help with --locale zh flag', () => {
    const output = execFileSync('node', [CLI_PATH, '--locale', 'zh', 'config', '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('用法:')
    expect(output).toContain('选项:')
    expect(output).toContain('示例:')

    const globalOutput = execFileSync('node', [CLI_PATH, '--locale', 'zh', '--help'], {
      encoding: 'utf-8',
    })
    expect(globalOutput).toContain('管理用户偏好设置')
    expect(globalOutput).toContain('命令:')
  })

  it('shows Chinese help after persisting locale=zh', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-locale-help-'))
    const env = { ...process.env, HOME: tempDir, XDG_CONFIG_HOME: join(tempDir, '.config') }

    execFileSync('node', [CLI_PATH, 'config', 'set', 'locale', 'zh'], {
      encoding: 'utf-8',
      env,
    })

    const output = execFileSync('node', [CLI_PATH, 'config', '--help'], {
      encoding: 'utf-8',
      env,
    })

    expect(output).toContain('用法:')
    expect(output).toContain('选项:')
    expect(output).toContain('示例:')

    const globalOutput = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
      env,
    })
    expect(globalOutput).toContain('管理用户偏好设置')
    expect(globalOutput).toContain('命令:')

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should show install command in help', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('install')
  })

  it('should show self-update command in help', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('self-update')
  })

  it('should append cc function to zshrc with --yes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))

    // Create fake claude binary for channel detection
    const fakeBinDir = join(tempDir, 'bin')
    mkdirSync(fakeBinDir, { recursive: true })
    const fakeClaude = join(fakeBinDir, 'claude')
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.170 (Claude Code)"')
    chmodSync(fakeClaude, 0o755)

    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# existing config\n')

    const env = { ...process.env, HOME: tempDir, PATH: `${fakeBinDir}:${process.env.PATH}` }
    execFileSync('node', [CLI_PATH, 'setup', '--yes'], {
      encoding: 'utf-8',
      env,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc()')
    expect(content).toContain("alias c='cc 27w'")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should backup existing cc function and alias in zshrc', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))

    const fakeBinDir = join(tempDir, 'bin')
    mkdirSync(fakeBinDir, { recursive: true })
    const fakeClaude = join(fakeBinDir, 'claude')
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.170"')
    chmodSync(fakeClaude, 0o755)

    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, `existing config\ncc() { echo old; }\nalias c='oldcmd'\n`)

    const env = { ...process.env, HOME: tempDir, PATH: `${fakeBinDir}:${process.env.PATH}` }
    execFileSync('node', [CLI_PATH, 'setup', '--yes'], {
      encoding: 'utf-8',
      env,
    })

    const content = readFileSync(zshrc, 'utf-8')
    expect(content).toContain('cc_backup()')
    expect(content).toContain('alias c_backup=')
    expect(content).toContain("alias c='cc 27w'")

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should error when cc-expand block already exists', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-setup-'))

    const fakeBinDir = join(tempDir, 'bin')
    mkdirSync(fakeBinDir, { recursive: true })
    const fakeClaude = join(fakeBinDir, 'claude')
    writeFileSync(fakeClaude, '#!/bin/bash\necho "2.1.170"')
    chmodSync(fakeClaude, 0o755)

    const zshrc = join(tempDir, '.zshrc')
    writeFileSync(zshrc, '# --- cc-expand generated start ---\ncc() {}\n# --- cc-expand generated end ---\n')

    const env = { ...process.env, HOME: tempDir, PATH: `${fakeBinDir}:${process.env.PATH}` }
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

    expect(output).toContain('[OK]')
    expect(output).toContain('2.1.161')
    expect(output).toContain('2.1.170')
  })

  it('should output JSON for config command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-config-'))
    const env = { ...process.env, HOME: tempDir, XDG_CONFIG_HOME: join(tempDir, '.config') }

    const output = execFileSync('node', [CLI_PATH, 'config', 'get', 'locale', '--json'], {
      encoding: 'utf-8',
      env,
    })

    const parsed = JSON.parse(output)
    expect(parsed.success).toBe(true)
    expect(parsed.command).toBe('config')
    expect(parsed.data).toEqual({ key: 'locale', value: 'en' })
    expect(parsed.locale).toBe('en')

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should output JSON for list command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-list-'))
    const env = { ...process.env, HOME: tempDir }

    const output = execFileSync('node', [CLI_PATH, 'list', '--json'], {
      encoding: 'utf-8',
      env,
    })

    const parsed = JSON.parse(output)
    expect(parsed.success).toBe(true)
    expect(parsed.command).toBe('list')
    expect(Array.isArray(parsed.data.versions)).toBe(true)

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('applies persisted locale preference to subsequent commands', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-locale-'))
    const env = { ...process.env, HOME: tempDir, XDG_CONFIG_HOME: join(tempDir, '.config') }

    // 持久化 locale=zh（ccx config set locale zh）
    execFileSync('node', [CLI_PATH, 'config', 'set', 'locale', 'zh'], {
      encoding: 'utf-8',
      env,
    })

    // 后续命令不带 -l 时应使用持久化的 zh（patched/unpatched/noBinary 任一路径都输出中文）
    const output = execFileSync('node', [CLI_PATH, 'status'], {
      encoding: 'utf-8',
      env,
    })

    // 含中文字符即证明 locale=zh 已从持久化偏好加载（默认 en 不会有中文）
    expect(output).toMatch(/[一-龥]/)

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('falls back gracefully for unsupported --locale value instead of crashing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-locale-'))
    const env = { ...process.env, HOME: tempDir }

    // -l fr 非法，应回退到 en 而非让 t() 崩溃
    const output = execFileSync('node', [CLI_PATH, '-l', 'fr', 'status'], {
      encoding: 'utf-8',
      env,
    })

    expect(output).toContain('Claude Code')

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should show migration command in help', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    })

    expect(output).toContain('migration')
  })

  it('should error when migration has no patches to migrate', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-migration-e2e-'))
    const env = { ...process.env, HOME: tempDir }
    let threw = false
    try {
      execFileSync('node', [CLI_PATH, 'migration', '2.1.178'], {
        encoding: 'utf-8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: any) {
      threw = true
      const combined = (error.stdout || '') + (error.stderr || '')
      expect(combined).toContain('No existing patches')
      expect(error.status).toBe(64)
    }
    expect(threw).toBe(true)
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Note: status command requires a working Claude Code binary with responsive --version
  // This test is skipped in CI where claude may not be available or may hang
  it.skip('should show status with found binary (requires working claude binary)', () => {
    const output = execFileSync('node', [CLI_PATH, 'status'], {
      encoding: 'utf-8',
      timeout: 10000,
    })

    expect(output).toContain('[OK]')
    expect(output).toContain('Binary:')
  })
})
