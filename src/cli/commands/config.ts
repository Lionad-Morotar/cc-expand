/**
 * config 命令
 * 管理用户偏好配置（locale, autoMaintain）
 */
import { UserConfigService, type UserPreferences } from '../../services/user-config.js'
import { ErrorCode } from '../../types/index.js'
import { t } from '../i18n.js'
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
      value = rawValue === 'true'
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
