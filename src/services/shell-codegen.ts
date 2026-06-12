/**
 * Shell profile 配置检测与 cc/c 快捷方式代码生成
 * 被 setup 和 shell-maintain 共用
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 检测当前 shell 的配置文件路径
 * macOS/Linux: ~/.zshrc（优先）、~/.bashrc（fallback）
 * Windows: PowerShell $PROFILE
 */
export function detectConfigFile(homeDir: string): string {
  if (process.platform === 'win32') {
    return join(
      homeDir,
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1',
    )
  }

  const zshrc = join(homeDir, '.zshrc')
  const bashrc = join(homeDir, '.bashrc')

  if (existsSync(zshrc)) return zshrc
  if (existsSync(bashrc)) return bashrc
  return zshrc
}

/**
 * 生成 bash/zsh cc 函数和 c alias
 */
export function generateBashFunction(targetTokens: number): string {
  const target = String(targetTokens)
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'cc() {',
    '  local default_flags="--dangerously-skip-permissions"',
    '',
    '  # 数字参数：指定 context window 大小',
    '  if [[ "$1" =~ ^[0-9]+$ ]]; then',
    '    local ctx="$1"',
    '    shift',
    `    local binary="$HOME/.cc-expand/bin/claude-\${ctx}"`,
    '',
    '    if [[ ! -x "$binary" ]]; then',
    `      echo "→ Installing Claude Code \${ctx}..." >&2`,
    `      cc-expand patch --target "\$ctx" --yes || {`,
    `        echo "Error: Failed to patch Claude Code \${ctx}" >&2`,
    '        return 1',
    '      }',
    '    fi',
    '',
    '    "$binary" $default_flags "$@"',
    '    return $?',
    '  fi',
    '',
    `  # 默认启动 ${target}`,
    `  local default_binary="$HOME/.cc-expand/bin/claude-${target}"`,
    '  if [[ ! -x "$default_binary" ]]; then',
    `    echo "Error: Default binary not found. Run: cc-expand patch --target ${target} --yes" >&2`,
    '    return 1',
    '  fi',
    '  "$default_binary" $default_flags "$@"',
    '}',
    `alias c='cc ${target}'`,
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 生成 PowerShell 函数（Windows 专用）
 */
export function generatePowerShellFunction(targetTokens: number): string {
  const target = String(targetTokens)
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'function cc {',
    `    param([string]$ctx = "${target}")`,
    '',
    '    $default_flags = "--dangerously-skip-permissions"',
    `    $binary = Join-Path $env:USERPROFILE ".cc-expand/bin/claude-\${ctx}.exe"`,
    '',
    '    if (-not (Test-Path $binary)) {',
    `        Write-Host "→ Installing Claude Code \${ctx}..." -ForegroundColor Yellow`,
    '        cc-expand patch --target $ctx --yes',
    '        if ($LASTEXITCODE -ne 0) {',
    `            Write-Error "Error: Failed to patch Claude Code \${ctx}"`,
    '            return 1',
    '        }',
    '    }',
    '',
    '    & $binary $default_flags @args',
    '}',
    '',
    'function c {',
    `    cc ${target} @args`,
    '}',
    '',
    'Set-Alias -Name cc-expand-cc -Value cc',
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 根据平台生成 shell 函数
 */
export function generateShellFunction(targetTokens: number): string {
  return process.platform === 'win32'
    ? generatePowerShellFunction(targetTokens)
    : generateBashFunction(targetTokens)
}
