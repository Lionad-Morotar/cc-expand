/**
 * setup command — 向 shell 配置文件安装 cc 快捷函数和 c alias
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CcxError, ErrorCode } from '../../types/index.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { PackageService } from '../../services/package.js'
import { formatSummary, highlight, formatNextSteps } from '../output.js'

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
function generateBashFunction(): string {
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
    '      cc-expand patch --target "$ctx" --yes || {',
    '        echo "Error: Failed to patch Claude Code ${ctx}" >&2',
    '        return 1',
    '      }',
    '    fi',
    '',
    '    "$binary" $default_flags "$@"',
    '    return $?',
    '  fi',
    '',
    '  # 默认启动 270k（检查是否存在）',
    '  local default_binary="$HOME/.cc-expand/bin/claude-270000"',
    '  if [[ ! -x "$default_binary" ]]; then',
    '    echo "Error: Default binary not found. Run: cc-expand patch --target 270000 --yes" >&2',
    '    return 1',
    '  fi',
    '  "$default_binary" $default_flags "$@"',
    '}',
    "alias c='cc 270000'",
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

/**
 * 生成 PowerShell 函数（Windows 专用）
 * 注意：不使用 $args 作为参数名（PowerShell 保留变量）
 */
function generatePowerShellFunction(): string {
  const lines = [
    '',
    '# --- cc-expand generated start ---',
    'function cc {',
    '    param([string]$ctx = "270000")',
    '',
    '    $default_flags = "--dangerously-skip-permissions"',
    '    $binary = Join-Path $env:USERPROFILE ".cc-expand/bin/claude-${ctx}.exe"',
    '',
    '    if (-not (Test-Path $binary)) {',
    '        Write-Host "→ Installing Claude Code ${ctx}..." -ForegroundColor Yellow',
    '        cc-expand patch --target $ctx --yes',
    '        if ($LASTEXITCODE -ne 0) {',
    '            Write-Error "Error: Failed to patch Claude Code ${ctx}"',
    '            return 1',
    '        }',
    '    }',
    '',
    '    & $binary $default_flags @args',
    '}',
    '',
    'function c {',
    '    cc 270000 @args',
    '}',
    '',
    'Set-Alias -Name cc-expand-cc -Value cc',
    '# --- cc-expand generated end ---',
    '',
  ]
  return lines.join('\n')
}

function generateShellFunction(): string {
  return process.platform === 'win32'
    ? generatePowerShellFunction()
    : generateBashFunction()
}

/**
 * 备份已存在的 cc() 函数和 alias 定义
 * 将 cc() 重命名为 cc_backup()，alias c= 重命名为 alias c_backup=
 * 支持多行函数定义（如 cc()\n{\n}）
 */
function backupExistingDefinitions(content: string): string {
  // 排除已备份的内容块
  if (content.includes('cc_backup') || content.includes('c_backup')) {
    return content
  }

  let result = content

  // 备份 alias c=（单行）
  result = result.replace(
    /^\s*alias\s+c\s*=/gm,
    'alias c_backup=',
  )

  // 备份 alias cc=（单行）
  result = result.replace(
    /^\s*alias\s+cc\s*=/gm,
    'alias cc_backup=',
  )

  // 备份 cc() 函数定义（支持单行和多行）
  // 匹配 "cc()" 后面可选空白，然后 "{" 开始的内容
  result = result.replace(
    /\bcc\s*\(\s*\)\s*(?:\n\s*)?\{/g,
    'cc_backup() {',
  )

  return result
}

export async function setupCommand(
  args: string[] = [],
  options?: SetupOptions,
): Promise<string | void> {
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
      (async (msg: string) => {
        const { confirm } = await import('@inquirer/prompts')
        return confirm({ message: msg })
      })
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

  // 保存版本到 channel.json，供后续 patch 命令使用
  if (version) {
    const channelConfig = new ChannelConfig(configDir)
    channelConfig.saveChannel({
      channel: 'local',
      path: join(configDir, 'packages', version),
      version,
    })

    const packagesDir = join(configDir, 'packages')
    const packageService = new PackageService(packagesDir)

    if (!packageService.isInstalled(version)) {
      console.log(`\nDownloading Claude Code ${version}...`)
      await packageService.install(version)
    }
  }

  const nextSteps: string[] = [
    `source ${configFile}   # 使快捷方式生效`,
  ]
  if (version) {
    nextSteps.push(`cc-expand patch --target 270000 --yes   # 创建默认 patch 版本`)
  }

  return [
    formatSummary('OK', 'Shell 快捷方式已安装'),
    '',
    `配置文件: ${highlight(configFile)}`,
    ...(version ? [`版本: ${highlight(version)}`] : []),
    formatNextSteps(nextSteps),
  ].join('\n')
}
