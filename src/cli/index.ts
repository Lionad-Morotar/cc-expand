/**
 * CLI entry point for cc-expand
 * Routes commands to respective handlers with cac
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isatty } from 'node:tty'
import cac from 'cac'
import { CcxError, ErrorCode } from '../types/index.js'
import { setLocale, normalizeLocale, t, type Locale } from './i18n.js'
import { getExitCode, type CommandResult } from './result.js'
import { createRenderer } from './renderer.js'
import { formatVersionLine } from './version-line.js'
import { runPager, DEFAULT_PAGE_SIZE } from './pager.js'
import { UserConfigService } from '../services/user-config.js'
import {
  shouldRunUpdateCheck,
  startUpdateCheck,
  awaitUpdateCheckHint
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
import { pluginsCommand, getPluginsHelp } from './commands/plugins.js'
import { INTERNAL_PLUGINS } from '../internal-plugins.js'

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

  // help 在 cac parse 阶段即输出，早于 action callback；
  // 必须在注册命令前确定本次 locale，才能让 help 文案走 i18n。
  function parseLocaleFlag(argv: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]
      if (arg === '-l' || arg === '--locale') {
        return argv[i + 1]
      }
      if (arg.startsWith('--locale=')) {
        return arg.slice('--locale='.length)
      }
      if (arg.startsWith('-l=')) {
        return arg.slice('-l='.length)
      }
    }
    return undefined
  }

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

  const currentLocale = resolveLocale(parseLocaleFlag(process.argv))
  setLocale(currentLocale)

  // 隐式更新检查 promise（与命令 action 并行启动，命令后 await）
  let updateCheckPromise: Promise<UpdateInfo | null> | null = null

  cli
    .option('--no-color', t('help.global.option.noColor'))
    .option('--quiet, -q', t('help.global.option.quiet'))
    .option('--json', t('help.global.option.json'))
    .option('--locale, -l <locale>', t('help.global.option.locale'))

  function getRenderer(options: Record<string, unknown>) {
    const locale = resolveLocale(options.locale as string | undefined)
    setLocale(locale)
    return createRenderer({
      color: options.color as boolean | undefined,
      quiet: options.quiet as boolean | undefined,
      json: options.json as boolean | undefined,
      locale
    })
  }

  // 渲染命令结果，并在非 run 命令后执行隐式更新检查（发现新版时提示到 stderr）
  async function renderResult(
    renderer: ReturnType<typeof createRenderer>,
    result: CommandResult,
    commandName: string,
    cliOptions: Record<string, unknown> = {}
  ): Promise<void> {
    // pager 分支：仅在 TTY 且非 JSON/quiet/--all、且版本数超过单页时启用；
    // 满足时先打 [OK] summary 行，再让 pager 接管，退出后补一行 hint。
    // Why 独立分支：renderer.render 必须保持纯函数（返回 string|undefined），
    // pager 是 index.ts 层的副作用编排，不应侵入渲染层。
    if (shouldUsePager(result, cliOptions)) {
      const versions = (result.data as { versions: Array<Record<string, unknown>> }).versions
      // 复用 renderer 的 [OK] header，保证 pager 路径与 --all 静态路径前缀逐字符一致
      process.stdout.write(`${renderer.formatOkHeader(result)}\n`)
      try {
        await runPager(versions.map(v => formatVersionLine(v)))
      } catch {
        // pager 不可用（如 @inquirer/core 动态加载失败）：擦除已写的 header 行，
        // 降级为与 --all 一致的静态全量输出，不让命令静默失败或被 CI 误判为成功。
        // ANSI 擦行在此安全：shouldUsePager 已保证仅在 TTY 触发本分支。
        process.stdout.write('\x1b[1A\x1b[2K')
        console.error('Pager unavailable, falling back to full list')
        const fallback = renderer.render(result, commandName)
        if (fallback !== undefined) console.log(fallback)
        if (commandName !== 'run' && updateCheckPromise) {
          await awaitUpdateCheckHint(updateCheckPromise, line => console.error(line))
        }
        return
      }
      process.stdout.write('\nRun with --all to see full list\n')
      // 隐式更新检查照常进行
      if (commandName !== 'run' && updateCheckPromise) {
        await awaitUpdateCheckHint(updateCheckPromise, line => console.error(line))
      }
      return
    }

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
      await awaitUpdateCheckHint(updateCheckPromise, line => console.error(line))
    }
  }

  /**
   * 判定是否走交互 pager 分支。
   * 降级矩阵：--json / --quiet / 非 TTY（管道/重定向/CI）/ --all 全部退回静态全量输出。
   */
  function shouldUsePager(
    result: CommandResult,
    cliOptions: Record<string, unknown>
  ): boolean {
    if (!result.success) return false
    if (cliOptions.json === true) return false
    if (cliOptions.quiet === true) return false
    if (cliOptions.all === true) return false
    // 非 TTY（管道/重定向/CI）：静态全量，保证可被脚本消费
    if (!isatty(process.stdout.fd)) return false
    const data = result.data as { versions?: unknown } | undefined
    if (!data || !Array.isArray(data.versions)) return false
    return data.versions.length > DEFAULT_PAGE_SIZE
  }

  /**
   * 翻译 cac help 输出的章节标题。
   * cac 的标题是框架写死的英文，通过 cli.help() 回调在输出前替换为当前 locale。
   */
  function localizeHelpSections(sections: Array<{ title?: string, body: string }>): Array<{ title?: string, body: string }> {
    const titleMap: Record<string, string> = {
      'Usage': t('help.section.usage'),
      'Options': t('help.section.options'),
      'Commands': t('help.section.commands'),
      'Examples': t('help.section.examples'),
      'For more info, run any command with the `--help` flag': t('help.section.moreInfo')
    }
    return sections.map((section) => {
      if (!section.title) return section
      const translated = titleMap[section.title]
      if (!translated) return section
      return { ...section, title: translated }
    })
  }

  cli
    .command('config <subcommand> [key] [value]', t('help.command.config.description'))
    .usage('config <get|set|lang> [key] [value]')
    .example('  $ ccx config get locale')
    .example('  $ ccx config set locale zh')
    .example('  $ ccx config set autoMaintain true')
    .example('  $ ccx config lang zh')
    .action(async (subcommand: string, key: string | undefined, value: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await configCommand([subcommand, key, value].filter(Boolean) as string[])
      await renderResult(renderer, result, 'config')
    })

  cli
    .command('status', t('help.command.status.description'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await statusCommand()
      await renderResult(renderer, result, 'status')
    })

  cli
    .command('supports', t('help.command.supports.description'))
    .option('--all', t('help.command.supports.option.all'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await supportsCommand()
      await renderResult(renderer, result, 'supports', options)
    })

  cli
    .command('install [version]', t('help.command.install.description'))
    .action(async (positionalVersion: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (positionalVersion) args.push(positionalVersion)
      const result = await installCommand(args)
      await renderResult(renderer, result, 'install')
    })

  cli
    .command('setup', t('help.command.setup.description'))
    .option('-y, --yes', t('help.command.setup.option.yes'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.yes) args.push('--yes')
      const result = await setupCommand(args)
      await renderResult(renderer, result, 'setup')
    })

  cli
    .command('restore', t('help.command.restore.description'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await restoreCommand()
      await renderResult(renderer, result, 'restore')
    })

  cli
    .command('verify', t('help.command.verify.description'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await verifyCommand()
      await renderResult(renderer, result, 'verify')
    })

  cli
    .command('run [combo]', t('help.command.run.description'))
    .example('  $ ccx run')
    .example('  $ ccx run 27w')
    .example('  $ ccx run 27w-flow')
    .option('--print-binary', t('help.command.run.option.printBinary'))
    .action(async (combo: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await runCommand(combo, { printBinary: !!options.printBinary })
      if (result && !result.success) {
        // run 失败时（binary 缺失或 spawn 失败）打印错误，否则用户只看到退出码看不到原因
        const rendered = renderer.render(result, 'run')
        if (rendered !== undefined) console.error(rendered)
        process.exit(getExitCode(result.error?.code as ErrorCode | undefined))
      }
      if (options.printBinary && result && result.success) {
        // --print-binary 已直接输出 binary 路径，无需渲染，直接退出
        process.exit(0)
      }
      // run 成功时 child 进程接管 stdio，无需渲染，也跳过更新检查（promise 被 exec 遗弃）
    })

  cli
    .command('patch [action] [version] [combo]', t('help.command.patch.description'))
    .usage('patch <version> [options]\n  $ ccx patch remove <version> [combo]')
    .example('  $ ccx patch 2.1.186 --target 270000')
    .example('  $ ccx patch 2.1.186 --target 27w --yes')
    .example('  $ ccx patch remove 2.1.186 27w')
    .example('  $ ccx patch remove 2.1.186')
    .option('-t, --target <count>', t('help.command.patch.option.target'))
    .option('-y, --yes', t('help.command.patch.option.yes'))
    .action(async (action: string | undefined, version: string | undefined, combo: string | undefined, options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = [action, version, combo].filter(Boolean) as string[]
      if (options.target) args.push('--target', String(options.target))
      if (options.yes) args.push('--yes')
      const result = await patchCommand(args)
      await renderResult(renderer, result, 'patch')
    })

  cli
    .command('migration [version|latest]', t('help.command.migration.description'))
    .example('  $ ccx migration latest')
    .example('  $ ccx migration 2.1.186 --from 2.1.170 --dry-run')
    .option('--from <version>', t('help.command.migration.option.from'))
    .option('-y, --yes', t('help.command.migration.option.yes'))
    .option('--dry-run', t('help.command.migration.option.dryRun'))
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
    .command('list', t('help.command.list.description'))
    .option('--patched', t('help.command.list.option.patched'))
    .option('--all', t('help.command.list.option.all'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const args: string[] = []
      if (options.patched) args.push('--patched')
      const result = await listCommand(args)
      await renderResult(renderer, result, 'list', options)
    })

  cli
    .command('self-update', t('help.command.selfUpdate.description'))
    .action(async (options: Record<string, unknown>) => {
      const renderer = getRenderer(options)
      const result = await selfUpdateCommand()
      await renderResult(renderer, result, 'self-update')
    })

  cli
    .command('plugins [list|enable|disable|remove|add] [name]', t('help.command.plugins.description'))
    .example('  $ ccx plugins list')
    .example('  $ ccx plugins enable flow')
    .example('  $ ccx plugins disable flow')
    .example('  $ ccx plugins add owner/repo')
    .action(async (subcommand: string | undefined, name: string | undefined, options: Record<string, unknown>) => {
      // 无子命令默认显示 help（子命令清单 + 用法），等同 ccx plugins -h
      if (!subcommand) {
        console.log(getPluginsHelp(currentLocale))
        return
      }
      const renderer = getRenderer(options)
      const args = [subcommand, name].filter(Boolean) as string[]
      const result = await pluginsCommand(args, { internalPlugins: INTERNAL_PLUGINS })
      await renderResult(renderer, result, 'plugins')
    })

  cli.help(sections => localizeHelpSections(sections))
  cli.version(getVersion())

  // cac 内部写死的 help/version 选项描述需要单独覆盖为当前 locale
  const helpOption = cli.globalCommand.options.find(o => o.name === 'help')
  if (helpOption) helpOption.description = t('help.global.option.help')
  const versionOption = cli.globalCommand.options.find(o => o.name === 'version')
  if (versionOption) versionOption.description = t('help.global.option.version')

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
        locale: resolveLocale(parsed.options.locale as string | undefined)
      })
      const rendered = renderer.render(
        {
          success: false,
          command: commandName ?? '',
          summary: commandName ? `Unknown command: ${commandName}` : 'No command specified',
          error: {
            code: ErrorCode.INVALID_TARGET,
            message: commandName ? `Unknown command: ${commandName}` : 'No command specified',
            suggestion: 'Run `ccx --help` to see available commands.'
          }
        },
        commandName ?? ''
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
