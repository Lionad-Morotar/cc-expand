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
    '  local binary',
    '',
    '  # 数字参数：指定 context window 大小',
    '  if [[ "$1" =~ ^[0-9]+$ ]]; then',
    '    local ctx="$1"',
    '    shift',
    `    binary="$HOME/.cc-expand/bin/claude-\${ctx}"`,
    '',
    '    if [[ ! -x "$binary" ]]; then',
    `      echo "→ Installing Claude Code \${ctx}..." >&2`,
    `      cc-expand patch --target "\$ctx" --yes || {`,
    `        echo "Error: Failed to patch Claude Code \${ctx}" >&2`,
    '        return 1',
    '      }',
    '    fi',
    '  else',
    `    # 默认启动 ${target}`,
    `    binary="$HOME/.cc-expand/bin/claude-${target}"`,
    '    if [[ ! -x "$binary" ]]; then',
    `      echo "Error: Default binary not found. Run: cc-expand patch --target ${target} --yes" >&2`,
    '      return 1',
    '    fi',
    '  fi',
    '',
    '  # 版本校验：避免静默跑过时的 patched binary（版本孤儿）。',
    '  # binary 版本必须 == channel.json 的 active version；--version 失败（坏 binary）也算不符。',
    `  local active_version=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9.]+"' "$HOME/.cc-expand/channel.json" 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)`,
    '  if [[ -n "$active_version" ]]; then',
    `    local bin_version=$("\$binary" --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)`,
    '    if [[ -z "$bin_version" || "$bin_version" != "$active_version" ]]; then',
    `      echo "⚠️  patched claude 版本不匹配：binary 是 \${bin_version:-损坏}，当前激活 \${active_version}。重新 patch: cc-expand patch --yes" >&2`,
    '      return 1',
    '    fi',
    '  fi',
    '',
    '  "$binary" $default_flags "$@"',
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

/**
 * 生成"指向原版 Claude Code"的 bash/zsh 函数块
 * 用于 restore：保留 cc/c 快捷方式结构，但调用系统原版 claude 而非 patched binary
 * 与 generateBashFunction 对称——只换底层 binary，保留 --dangerously-skip-permissions 习惯
 */
export function generateRestoredBashFunction(): string {
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'cc() {',
    '  # restore 后：cc/c 直接调用原版 Claude Code',
    '  claude --dangerously-skip-permissions "$@"',
    '}',
    "alias c='cc'",
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 生成"指向原版 Claude Code"的 PowerShell 函数块（Windows 专用）
 */
export function generateRestoredPowerShellFunction(): string {
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'function cc {',
    '    # restore 后：cc/c 直接调用原版 Claude Code',
    '    claude --dangerously-skip-permissions @args',
    '}',
    '',
    'function c {',
    '    cc @args',
    '}',
    '',
    'Set-Alias -Name cc-expand-cc -Value cc',
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 根据平台生成"指向原版"的 shell 函数块（restore 专用）
 */
export function generateRestoredShellFunction(): string {
  return process.platform === 'win32'
    ? generateRestoredPowerShellFunction()
    : generateRestoredBashFunction()
}
