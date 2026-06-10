/**
 * setup command — 向 shell 配置文件安装 cc 快捷函数和 c alias
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { confirm } from '@inquirer/prompts'
import { CcxError, ErrorCode } from '../../types/index.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { PackageService } from '../../services/package.js'

export interface SetupOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
  /** 覆盖默认的 confirm 函数（用于测试） */
  confirm?: (message: string) => Promise<boolean>
  /** 直接指定版本（用于测试，跳过检测） */
  version?: string
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
 * 渠道无关：直接从 ~/.cc-expand/bin/ 运行 patched binary
 */
function generateShellFunction(): string {
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
    '    local binary="$HOME/.cc-expand/bin/claude-${ctx}"',
    '',
    '    if [[ ! -x "$binary" ]]; then',
    '      echo "→ Installing Claude Code ${ctx}..." >&2',
    '      cc-expand patch --target "$ctx" --yes',
    '    fi',
    '',
    '    "$binary" $default_flags "$@"',
    '    return $?',
    '  fi',
    '',
    '  # 默认启动 270k',
    '  local default_binary="$HOME/.cc-expand/bin/claude-270000"',
    '  "$default_binary" $default_flags "$@"',
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
  const configDir = join(homeDir, '.cc-expand')

  // 确保配置目录存在
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

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

  // 版本选择
  let version: string | undefined

  if (options?.version) {
    version = options.version
  } else {
    const channelConfig = new ChannelConfig(configDir)

    if (channelConfig.hasChannel()) {
      version = channelConfig.getChannel()?.version
      console.log(`Using saved version: ${version}`)
    }
  }

  // 交互式确认
  if (!skipConfirm) {
    const doConfirm =
      options?.confirm ??
      (async (msg: string) => confirm({ message: msg }))
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

  // 如果指定了版本，下载并 patch
  if (version) {
    const packagesDir = join(configDir, 'packages')
    const packageService = new PackageService(packagesDir)

    if (!packageService.isInstalled(version)) {
      console.log(`\nDownloading Claude Code ${version}...`)
      await packageService.install(version)
    }

    console.log(`\n→ Run 'cc-expand patch --target 270000 --yes' to create your first patched binary`)
  }
}
