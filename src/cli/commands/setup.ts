/**
 * setup command — 向 shell 配置文件安装 cc 快捷函数和 c alias
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { confirm } from '@inquirer/prompts'
import { CcxError, ErrorCode } from '../../types/index.js'

export interface SetupOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
  /** 覆盖默认的 confirm 函数（用于测试） */
  confirm?: (message: string) => Promise<boolean>
}

/**
 * 检测当前 shell 的配置文件路径
 * macOS/Linux: ~/.zshrc（优先）、~/.bashrc（fallback）
 * Windows: PowerShell $PROFILE
 */
function detectConfigFile(homeDir: string): string {
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
 * 生成 cc 函数和 c alias 的 shell 代码
 *
 * 工程计划中的完整设计：
 * - 数字参数：指定 context window 大小，自动 patch 并启动
 * - 非数字参数：直接传给 npx claude
 * - 预构建二进制缓存于 ~/.claude/bin/claude-${ctx}
 * - 版本检查：对比 npx 缓存版本 vs 已 patch 版本
 */
function generateShellFunction(): string {
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'cc() {',
    '  local default_flags="--dangerously-skip-permissions"',
    '  local ctx_bin_dir="$HOME/.claude/bin"',
    '',
    '  # Helper: get latest npx cached claude version',
    '  _cc_expand_latest_npx_version() {',
    '    local latest=""',
    '    local pkg',
    '    for pkg in "$HOME/.npm/_npx"/*/node_modules/@anthropic-ai/claude-code/package.json; do',
    '      [[ -f "$pkg" ]] || continue',
    '      local v=$(grep \'"version"\' "$pkg" | head -1 | sed \'s/.*"\\([0-9.]*\\)".*/\\1/\')',
    '      [[ -n "$v" ]] || continue',
    '      if [[ -z "$latest" ]] || [[ "$v" > "$latest" ]]; then',
    '        latest="$v"',
    '      fi',
    '    done',
    '    echo "$latest"',
    '  }',
    '',
    '  # 数字参数：指定 context window 大小',
    '  if [[ "$1" =~ ^[0-9]+$ ]]; then',
    '    local ctx="$1"',
    '    shift',
    '',
    '    local prebuilt="${ctx_bin_dir}/claude-${ctx}"',
    '    local version_file="${ctx_bin_dir}/claude-${ctx}.version"',
    '',
    '    # 检查预构建二进制是否存在且版本匹配',
    '    if [[ -x "$prebuilt" && -f "$version_file" ]]; then',
    '      local npx_version=$(_cc_expand_latest_npx_version)',
    '      local patch_version=$(cat "$version_file" 2>/dev/null | tr -d \'[:space:]\')',
    '',
    '      if [[ -n "$npx_version" && "$npx_version" != "$patch_version" && -z "$_CC_SKIP_VERSION_CHECK" ]]; then',
    '        echo "⚠️  Claude Code version mismatch detected" >&2',
    '        echo "   Patched binary: $patch_version" >&2',
    '        echo "   Current npx:    $npx_version" >&2',
    '        echo -n "   Re-patch for ${ctx} context? [Y/n/o] " >&2',
    '        read -r answer < /dev/tty',
    '        if [[ "$answer" =~ ^[Nn]$ ]]; then',
    '          echo "→ Falling back to npx default (200k context)" >&2',
    '          npx -y @anthropic-ai/claude-code@latest $default_flags "$@"',
    '          return $?',
    '        elif [[ "$answer" =~ ^[Oo]$ ]]; then',
    '          echo "→ Using old patched binary for this terminal only" >&2',
    '          export _CC_SKIP_VERSION_CHECK=1',
    '          "$prebuilt" $default_flags "$@"',
    '          return $?',
    '        else',
    '          # Y 或回车：重新 patch',
    '          echo "→ Re-patching ${ctx} context..." >&2',
    '          rm -f "$prebuilt"',
    '        fi',
    '      else',
    '        "$prebuilt" $default_flags "$@"',
    '        return $?',
    '      fi',
    '    fi',
    '',
    '    # 没有预构建二进制，或用户选择重新 patch',
    '    echo "→ Generating patched binary for ${ctx} context..." >&2',
    '    npx -y cc-expand@latest patch --target "$ctx" --yes',
    '    if [[ $? -ne 0 ]]; then',
    '      echo "Error: patch failed" >&2',
    '      return 1',
    '    fi',
    '',
    '    # 记录版本',
    '    _cc_expand_latest_npx_version > "$version_file"',
    '',
    '    # 启动',
    '    npx -y cc-expand@latest run --yes',
    '    return $?',
    '  fi',
    '',
    '  # 非数字参数：直接传给 npx claude',
    '  npx -y @anthropic-ai/claude-code@latest $default_flags "$@"',
    '}',
    "alias c='cc 270000'",
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 备份已存在的 cc() 函数和 alias 定义
 * 将 cc() 重命名为 cc_backup()，alias c= 重命名为 alias c_backup=
 */
function backupExistingDefinitions(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      // cc() 函数定义（排除已备份的 cc_backup）
      if (/^\s*cc\s*\(\s*\)\s*\{/.test(line) && !line.includes('cc_backup')) {
        return line.replace(/cc\s*\(\s*\)\s*\{/, 'cc_backup() {')
      }
      // alias c=（排除已备份的 c_backup）
      if (/^\s*alias\s+c\s*=/.test(line) && !line.includes('c_backup')) {
        return line.replace(/alias\s+c\s*=/, 'alias c_backup=')
      }
      // alias cc=（排除已备份的 cc_backup）
      if (/^\s*alias\s+cc\s*=/.test(line) && !line.includes('cc_backup')) {
        return line.replace(/alias\s+cc\s*=/, 'alias cc_backup=')
      }
      return line
    })
    .join('\n')
}

export async function setupCommand(
  args: string[] = [],
  options?: SetupOptions,
): Promise<void> {
  // 解析参数
  let skipConfirm = false
  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      skipConfirm = true
    }
  }

  const homeDir = options?.homeDir ?? homedir()
  const configFile = detectConfigFile(homeDir)

  // 读取现有配置
  let content = ''
  if (existsSync(configFile)) {
    content = readFileSync(configFile, 'utf-8')
  }

  // 检测是否已安装过
  if (content.includes('# --- cc-expand generated start ---')) {
    throw new CcxError(
      ErrorCode.PERMISSION_DENIED,
      'cc-expand shell integration is already installed',
      `Remove the existing block from ${configFile} or use --force to overwrite`,
    )
  }

  // 交互式确认
  if (!skipConfirm) {
    const doConfirm = options?.confirm ?? (async (msg: string) => confirm({ message: msg }))
    const confirmed = await doConfirm(
      `Install cc-expand shell integration to ${configFile}?`,
    )
    if (!confirmed) {
      console.log('Setup cancelled.')
      return
    }
  }

  // 备份已有定义
  content = backupExistingDefinitions(content)

  // 追加生成的函数
  const shellCode = generateShellFunction()
  writeFileSync(configFile, content + shellCode, 'utf-8')

  console.log(`✓ cc-expand shell integration installed to ${configFile}`)
  console.log(`  Run 'source ${configFile}' or restart your terminal to use 'cc' and 'c'`)
}
