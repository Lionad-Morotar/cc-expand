/**
 * config 命令
 * 管理用户偏好配置（locale, autoMaintain）
 */
import { UserConfigService, type UserPreferences } from '../../services/user-config.js'
import { CcxError, ErrorCode } from '../../types/index.js'
import { isLocale, t } from '../i18n.js'
import { makeErrorResult, type CommandResult } from '../result.js'

export interface ConfigCommandOptions {
  userConfigService?: UserConfigService
}

type KnownKey = keyof UserPreferences

const KNOWN_KEYS: KnownKey[] = ['locale', 'autoMaintain']

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
    'Use one of: true/false, 1/0, yes/no, on/off',
  )
}

export async function configCommand(
  args: string[],
  options?: ConfigCommandOptions,
): Promise<CommandResult> {
  const service = options?.userConfigService ?? new UserConfigService()
  const [subcommand, key, rawValue] = args

  if (!subcommand) {
    return makeErrorResult(
      'config',
      ErrorCode.INVALID_TARGET,
      t('error.missingArgument', { name: 'subcommand' }),
      'Usage: ccx config get|set|lang',
    )
  }

  if (subcommand === 'get') {
    if (!key) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'key' }),
        'Usage: ccx config get <key>',
      )
    }

    if (!isKnownKey(key)) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.unknownKey', { key }),
        `Supported keys: ${KNOWN_KEYS.join(', ')}`,
      )
    }

    const value = service.get(key)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.get', { key, value: formatValue(value) }),
      data: { key, value },
    }
  }

  if (subcommand === 'set') {
    if (!key) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'key' }),
        'Usage: ccx config set <key> <value>',
      )
    }

    if (!isKnownKey(key)) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.unknownKey', { key }),
        `Supported keys: ${KNOWN_KEYS.join(', ')}`,
      )
    }

    if (rawValue === undefined) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.missingArgument', { name: 'value' }),
        'Usage: ccx config set <key> <value>',
      )
    }

    let value: UserPreferences[KnownKey]
    if (key === 'autoMaintain') {
      try {
        value = parseBoolean(rawValue)
      } catch (error) {
        const message = error instanceof CcxError ? error.message : `Invalid boolean value: ${rawValue}`
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          message,
          'Use one of: true/false, 1/0, yes/no, on/off',
        )
      }
    } else if (key === 'locale') {
      // locale 必须是 en/zh，防止后续 setLocale/t() 因越界 locale 崩溃
      if (!isLocale(rawValue)) {
        return makeErrorResult(
          'config',
          ErrorCode.INVALID_TARGET,
          t('error.invalidTarget', { value: rawValue }),
          'Usage: ccx config set locale en|zh',
        )
      }
      value = rawValue
    } else {
      value = rawValue as UserPreferences[KnownKey]
    }

    service.set(key, value)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.set', { key, value: formatValue(value) }),
      data: { key, value },
    }
  }

  if (subcommand === 'lang') {
    const locale = key
    if (!locale || (locale !== 'en' && locale !== 'zh')) {
      return makeErrorResult(
        'config',
        ErrorCode.INVALID_TARGET,
        t('error.invalidTarget', { value: locale ?? '' }),
        'Usage: ccx config lang en|zh',
      )
    }

    service.set('locale', locale)
    return {
      success: true,
      command: 'config',
      summary: t('command.config.lang', { value: locale }),
      data: { key: 'locale', value: locale },
    }
  }

  return makeErrorResult(
    'config',
    ErrorCode.INVALID_TARGET,
    `Unknown subcommand: ${subcommand}`,
    'Usage: ccx config get|set|lang',
  )
}
