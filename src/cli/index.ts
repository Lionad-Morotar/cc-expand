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
import {
  shouldRunUpdateCheck,
  startUpdateCheck,
  awaitUpdateCheckHint,
} from './update-check-runner.js'
import type { UpdateInfo } from '../services/update-check.js'
import { configCommand } from './commands/config.js'
import { statusCommand } from './commands/status.js'
import { supportsCommand } from './commands/supports.js'
import { installCommand } from './commands/install.js'
import { setupCommand } from './commands/setup.js'
import { restoreCommand } from './commands/restore.js'
import { verifyCommand } from './commands/verify.js'
import { runCommand } from './commands/run.js'
import { patchCommand } from './commands/patch.js'
import { migrationCommand } from './commands/migration.js'
import { listCommand } from './commands/list.js'
import { selfUpdateCommand } from './commands/self-update.js'

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

  // 隐式更新检查 promise（与命令 action 并行启动，命令后 await）
  let updateCheckPromise: Promise<UpdateInfo | null> | null = null

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

  // 渲染命令结果，并在非 run 命令后执行隐式更新检查（发现新版时提示到 stderr）
  async function renderResult(
    renderer: ReturnType<typeof createRenderer>,
    result: CommandResult,
    commandName: string,
  ): Promise<void> {
    const rendered = renderer.render(result, commandName)
    if (rendered !== undefined) {
      if (result.success) {
        console.log(rendered)
      } else {
        console.error(rendered)
        process.exit(getExitCode(result.error?.code as ErrorCode | undefined))
      }
    }
    // 隐式更新检查：run 命令 exec 接管进程不检查；失败已 exit 不会执行到这
    if (commandName !== 'run' && updateCheckPromise) {
      await awaitUpdateCheckHint(updateCheckPromise, (line) => console.error(line))
    }
  }

  cli
    .command('config <subcommand> [key] [value]', 'Manage user preferences')
    .action(async (subcommand: string, key: string | undefined, value: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await configCommand([subcommand, key, value].filter(Boolean) as string[])
      await renderResult(renderer, result, 'config')
    })

  cli
    .command('status', 'Show current patch status')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await statusCommand()
      await renderResult(renderer, result, 'status')
    })

  cli
    .command('supports', 'List supported Claude Code versions')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await supportsCommand()
      await renderResult(renderer, result, 'supports')
    })

  cli
    .command('install [version]', 'Download Claude Code via npm')
    .action(async (positionalVersion: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (positionalVersion) args.push(positionalVersion)
      const result = await installCommand(args)
      await renderResult(renderer, result, 'install')
    })

  cli
    .command('setup', 'Install shell shortcuts (cc, c)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.yes) args.push('--yes')
      const result = await setupCommand(args)
      await renderResult(renderer, result, 'setup')
    })

  cli
    .command('restore', 'Restore original binary')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await restoreCommand()
      await renderResult(renderer, result, 'restore')
    })

  cli
    .command('verify', 'Check patch status')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await verifyCommand()
      await renderResult(renderer, result, 'verify')
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
      // run 成功时 child 进程接管 stdio，无需渲染，也跳过更新检查（promise 被 exec 遗弃）
    })

  cli
    .command('patch [version]', 'Patch local Claude Code binary')
    .option('-t, --target <count>', 'Target context window size')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (positionalVersion: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (positionalVersion) args.push(positionalVersion)
      if (options.target) args.push('--target', String(options.target))
      if (options.yes) args.push('--yes')
      const result = await patchCommand(args)
      await renderResult(renderer, result, 'patch')
    })

  cli
    .command('migration [version]', 'Migrate existing patches to a target version')
    .option('--from <version>', 'Source version to migrate from')
    .option('-y, --yes', 'Skip confirmation')
    .option('--dry-run', 'Preview without applying')
    .action(async (positionalVersion: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (positionalVersion) args.push(positionalVersion)
      if (options.from) args.push('--from', String(options.from))
      if (options.yes) args.push('--yes')
      if (options.dryRun) args.push('--dry-run')
      const result = await migrationCommand(args)
      await renderResult(renderer, result, 'migration')
    })

  cli
    .command('list', 'List installed and patched versions')
    .option('--patched', 'Show only patched versions')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.patched) args.push('--patched')
      const result = await listCommand(args)
      await renderResult(renderer, result, 'list')
    })

  cli
    .command('self-update', 'Update cc-expand to the latest npm version')
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await selfUpdateCommand()
      await renderResult(renderer, result, 'self-update')
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

    // 启动隐式更新检查（与命令 action 并行执行，命令后由 renderResult await）
    const matchedName = (cli.matchedCommand as { name: string } | null)?.name
    if (shouldRunUpdateCheck(matchedName, new UserConfigService())) {
      updateCheckPromise = startUpdateCheck(getVersion())
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
