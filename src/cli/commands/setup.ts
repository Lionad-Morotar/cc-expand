/**
 * setup command — 向 shell 配置文件安装 cc 快捷函数和 c alias
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CcxError, ErrorCode } from '../../types/index.js'
import { ChannelConfig } from '../../services/channel-config.js'
import { PackageService } from '../../services/package.js'
import {
  detectConfigFile,
  generateShellFunction,
} from '../../services/shell-codegen.js'
import { t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'
import { normalizeVersion } from '../../utils/version.js'

export interface SetupData {
  configFile: string
  version?: string
  defaultTarget: number
  installedVersion?: string
}

export interface SetupOptions {
  /** 覆盖默认的 home 目录（用于测试） */
  homeDir?: string
  /** 覆盖默认的 confirm 函数（用于测试） */
  confirm?: (message: string) => Promise<boolean>
  /** 直接指定版本（用于测试，跳过检测） */
  version?: string
  /** 默认 target tokens */
  defaultTarget?: number
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
): Promise<CommandResult<SetupData>> {
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
    return makeErrorResult(
      'setup',
      ErrorCode.PERMISSION_DENIED,
      'cc-expand shell integration is already installed',
      `Remove the existing block from ${configFile} or use --force to overwrite`,
    )
  }

  // 版本选择
  let version: string | undefined

  if (options?.version) {
    version = normalizeVersion(options.version)
  } else {
    const channelConfig = new ChannelConfig(configDir)

    if (channelConfig.hasChannel()) {
      version = channelConfig.getChannel()?.version
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
      return {
        success: true,
        command: 'setup',
        summary: 'Setup cancelled',
        data: { configFile, defaultTarget: options?.defaultTarget ?? 270000 },
      }
    }
  }

  // 备份已有定义
  content = backupExistingDefinitions(content)

  // 追加生成的函数
  const defaultTarget = options?.defaultTarget ?? 270000
  const shellCode = generateShellFunction(defaultTarget)
  writeFileSync(configFile, content + shellCode, 'utf-8')

  // 保存版本到 channel.json，供后续 patch 命令使用
  let installedVersion: string | undefined
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
      try {
        await packageService.install(version)
        installedVersion = version
      } catch (error) {
        if (error instanceof CcxError) {
          return makeErrorResult('setup', error.code, error.message, error.suggestion)
        }
        return makeErrorResult(
          'setup',
          ErrorCode.BINARY_NOT_FOUND,
          `Failed to install Claude Code ${version}`,
          'Check your network connection and npm registry access',
        )
      }
    }
  }

  return {
    success: true,
    command: 'setup',
    summary: t('command.setup.success'),
    data: {
      configFile,
      version,
      defaultTarget,
      installedVersion,
    },
    next: ['source ' + configFile],
  }
}
