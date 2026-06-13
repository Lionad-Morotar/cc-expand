/**
 * CLI entry point for cc-expand
 * Routes commands to respective handlers with cac
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import cac from 'cac'
import { CcxError, ErrorCode } from '../types/index.js'
import { setLocale, normalizeLocale, type Locale } from './i18n.js'
import { getExitCode, type CommandResult } from './result.js'
import { createRenderer } from './renderer.js'
import { UserConfigService } from '../services/user-config.js'
import { configCommand } from './commands/config.js'
import { statusCommand } from './commands/status.js'
import { supportsCommand } from './commands/supports.js'
import { installCommand } from './commands/install.js'
import { setupCommand } from './commands/setup.js'
import { restoreCommand } from './commands/restore.js'
import { verifyCommand } from './commands/verify.js'
import { runCommand } from './commands/run.js'
import { patchCommand } from './commands/patch.js'
import { listCommand } from './commands/list.js'

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function main(): Promise<void> {
  const cli = cac('ccx')

  cli
    .option('--no-color', 'Disable ANSI colors')
    .option('--quiet, -q', 'Suppress non-error output')
    .option('--json', 'Output structured JSON')
    .option('--locale, -l <locale>', 'Set locale for this command (en or zh)')

  // 解析本次命令的 locale：优先级为 --locale/-l flag > 持久化用户偏好 > 'en'
  // 持久化偏好由 UserConfigService 管理（ccx config set locale <value>）
  function resolveLocale(flagValue: string | undefined): Locale {
    if (flagValue !== undefined) {
      return normalizeLocale(flagValue)
    }
    try {
      return normalizeLocale(new UserConfigService().get('locale'))
    } catch {
      return 'en'
    }
  }

  function getRenderer(options: Record<string, unknown>) {
    const locale = resolveLocale(options.locale as string | undefined)
    setLocale(locale)
    return createRenderer({
      color: options.color as boolean | undefined,
      quiet: options.quiet as boolean | undefined,
      json: options.json as boolean | undefined,
      locale,
    })
  }

  function renderResult(
    renderer: ReturnType<typeof createRenderer>,
    result: CommandResult,
    commandName: string,
  ): void {
    const rendered = renderer.render(result, commandName)
    if (rendered === undefined) return
    if (result.success) {
      console.log(rendered)
    } else {
      console.error(rendered)
      process.exit(getExitCode(result.error?.code as ErrorCode | undefined))
    }
  }

  cli
    .command('config <subcommand> [key] [value]', 'Manage user preferences')
    .action(async (subcommand: string, key: string | undefined, value: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await configCommand([subcommand, key, value].filter(Boolean) as string[])
      renderResult(renderer, result, 'config')
    })

  cli
    .command('status', 'Show current patch status')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await statusCommand()
      renderResult(renderer, result, 'status')
    })

  cli
    .command('supports', 'List supported Claude Code versions')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await supportsCommand()
      renderResult(renderer, result, 'supports')
    })

  cli
    .command('install [version]', 'Download Claude Code via npm')
    .option('-v, --version <ver>', 'Claude Code version')
    .action(async (positionalVersion: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.version) args.push('--version', String(options.version))
      if (positionalVersion) args.push(positionalVersion)
      const result = await installCommand(args)
      renderResult(renderer, result, 'install')
    })

  cli
    .command('setup', 'Install shell shortcuts (cc, c)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.yes) args.push('--yes')
      const result = await setupCommand(args)
      renderResult(renderer, result, 'setup')
    })

  cli
    .command('restore', 'Restore original binary')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await restoreCommand()
      renderResult(renderer, result, 'restore')
    })

  cli
    .command('verify', 'Check patch status')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await verifyCommand()
      renderResult(renderer, result, 'verify')
    })

  cli
    .command('run [tokens]', 'Launch patched Claude Code')
    .action(async (tokens: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await runCommand(tokens)
      if (result && !result.success) {
        // run 失败时（binary 缺失或 spawn 失败）打印错误，否则用户只看到退出码看不到原因
        const rendered = renderer.render(result, 'run')
        if (rendered !== undefined) console.error(rendered)
        process.exit(getExitCode(result.error?.code as ErrorCode | undefined))
      }
      // run 成功时 child 进程接管 stdio，无需渲染
    })

  cli
    .command('patch', 'Patch local Claude Code binary')
    .option('-t, --target <count>', 'Target context window size')
    .option('-v, --version <ver>', 'Claude Code version')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.target) args.push('--target', String(options.target))
      if (options.version) args.push('--version', String(options.version))
      if (options.yes) args.push('--yes')
      const result = await patchCommand(args)
      renderResult(renderer, result, 'patch')
    })

  cli
    .command('list', 'List installed and patched versions')
    .option('--patched', 'Show only patched versions')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.patched) args.push('--patched')
      const result = await listCommand(args)
      renderResult(renderer, result, 'list')
    })

  cli.help()
  cli.version(getVersion())

  try {
    const parsed = cli.parse(process.argv)

    // cac 已经输出 help/version 到 stdout，直接退出即可
    if (parsed.options.help || parsed.options.version) {
      return
    }

    if (!cli.matchedCommand) {
      const commandName = parsed.args[0]
      const renderer = createRenderer({
        color: parsed.options.color as boolean | undefined,
        quiet: parsed.options.quiet as boolean | undefined,
        json: parsed.options.json as boolean | undefined,
        locale: resolveLocale(parsed.options.locale as string | undefined),
      })
      const rendered = renderer.render(
        {
          success: false,
          command: commandName ?? '',
          summary: commandName ? `Unknown command: ${commandName}` : 'No command specified',
          error: {
            code: ErrorCode.INVALID_TARGET,
            message: commandName ? `Unknown command: ${commandName}` : 'No command specified',
            suggestion: 'Run `ccx --help` to see available commands.',
          },
        },
        commandName ?? '',
      )
      if (rendered !== undefined) {
        console.error(rendered)
      }
      process.exit(getExitCode(ErrorCode.INVALID_TARGET))
    }
  } catch (error) {
    if (error instanceof CcxError) {
      console.error(`[ERROR] ${error.message}`)
      process.exit(getExitCode(error.code))
    } else {
      console.error('[ERROR] Unexpected error:', error)
      process.exit(1)
    }
  }
}

main()
