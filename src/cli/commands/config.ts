/**
 * config 命令
 * 管理用户偏好配置（locale, autoMaintain, installMethod, autoUpdateCheck, updateCheckInterval）
 */
import { UserConfigService, type UserPreferences } from '../../services/user-config.js'
import { CcxError, ErrorCode, type InstallMethod } from '../../types/index.js'
import { isLocale, t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'

export interface ConfigCommandOptions {
  userConfigService?: UserConfigService
}

type KnownKey = keyof UserPreferences

const KNOWN_KEYS: KnownKey[] = [
  'locale',
  'autoMaintain',
  'installMethod',
  'autoUpdateCheck',
  'updateCheckInterval'
]

/** installMethod 合法值；self-update 引导的 npm/pnpm/yarn 必须在此列（引导可执行性契约） */
const INSTALL_METHODS: readonly InstallMethod[] = ['npm', 'pnpm', 'yarn', 'npx', 'unknown']

function isKnownKey(key: string): key is KnownKey {
  return KNOWN_KEYS.includes(key as KnownKey)
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on'])
const FALSE_VALUES = new Set(['false', '0', 'no', 'off'])

/**
 * 解析用户输入的布尔值，大小写不敏感
 * 识别 true/false/1/0/yes/no/on/off，其他值抛 CcxError 提示正确用法
 */
function parseBoolean(rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  throw new CcxError(
    ErrorCode.INVALID_TARGET,
    `Invalid boolean value: ${rawValue}`,
    'Use one of: true/false, 1/0, yes/no, on/off'
  )
}

/**
 * 解析正整数（用于 updateCheckInterval）
 * 拒绝非整数与 <= 0 的值，避免节流间隔为 0 导致每次启动都查询 npm registry
 */
function parsePositiveInt(rawValue: string): number {
  const n = Number(rawValue)
  if (!Number.isInteger(n) || n <= 0) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Invalid updateCheckInterval: ${rawValue}`,
      'Use a positive integer (milliseconds), e.g. 3600000'
    )
  }
  return n
}

export async function configCommand(
  args: string[],
  options?: ConfigCommandOptions
): Promise<CommandResult> {
  const service = options?.userConfigService ?? new UserConfigService()
  const [subcommand, key, rawValue] = args

  if (!subcommand) {
    return makeErrorResult(
      'config',
      ErrorCode.INVALID_TARGET,
      t('error.missingArgument', { name: 'subcommand' }),
      'Usage: ccx config get|set|lang'
    )
  }

  if (subcommand === 'get') {
    if (!key) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'key' }),
        'Usage: ccx config get <key>'
      )
    }

    if (!isKnownKey(key)) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.unknownKey', { key }),
        `Supported keys: ${KNOWN_KEYS.join(', ')}`
      )
    }

    const value = service.get(key)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.get', { key, value: formatValue(value) }),
      data: { key, value }
    }
  }

  if (subcommand === 'set') {
    if (!key) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'key' }),
        'Usage: ccx config set <key> <value>'
      )
    }

    if (!isKnownKey(key)) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.unknownKey', { key }),
        `Supported keys: ${KNOWN_KEYS.join(', ')}`
      )
    }

    if (rawValue === undefined) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'value' }),
        'Usage: ccx config set <key> <value>'
      )
    }

    let value: UserPreferences[KnownKey]
    if (key === 'autoMaintain' || key === 'autoUpdateCheck') {
      try {
        value = parseBoolean(rawValue)
      } catch (error) {
        const message = error instanceof CcxError ? error.message : `Invalid boolean value: ${rawValue}`
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          message,
          'Use one of: true/false, 1/0, yes/no, on/off'
        )
      }
    } else if (key === 'locale') {
      // locale 必须是 en/zh，防止后续 setLocale/t() 因越界 locale 崩溃
      if (!isLocale(rawValue)) {
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          t('error.invalidTarget', { value: rawValue }),
          'Usage: ccx config set locale en|zh'
        )
      }
      value = rawValue
    } else if (key === 'installMethod') {
      // installMethod 必须是合法安装方式，self-update 据此路由更新命令
      if (!INSTALL_METHODS.includes(rawValue as InstallMethod)) {
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          t('error.invalidTarget', { value: rawValue }),
          `Usage: ccx config set installMethod ${INSTALL_METHODS.join('|')}`
        )
      }
      value = rawValue as InstallMethod
    } else if (key === 'updateCheckInterval') {
      // updateCheckInterval 必须是正整数（毫秒），0 或负数会让节流失效
      try {
        value = parsePositiveInt(rawValue)
      } catch (error) {
        const message
          = error instanceof CcxError ? error.message : `Invalid updateCheckInterval: ${rawValue}`
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          message,
          error instanceof CcxError ? error.suggestion : 'Use a positive integer (milliseconds)'
        )
      }
    } else {
      value = rawValue as UserPreferences[KnownKey]
    }

    service.set(key, value)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.set', { key, value: formatValue(value) }),
      data: { key, value }
    }
  }

  if (subcommand === 'lang') {
    const locale = key
    if (!locale || (locale !== 'en' && locale !== 'zh')) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.invalidTarget', { value: locale ?? '' }),
        'Usage: ccx config lang en|zh'
      )
    }

    service.set('locale', locale)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.lang', { value: locale }),
      data: { key: 'locale', value: locale }
    }
  }

  return makeErrorResult(
    'config',
    ErrorCode.INVALID_TARGET,
    `Unknown subcommand: ${subcommand}`,
    'Usage: ccx config get|set|lang'
  )
}
