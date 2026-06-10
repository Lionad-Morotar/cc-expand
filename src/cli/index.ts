/**
 * CLI entry point for cc-expand
 * Routes commands to respective handlers
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CcxError } from '../types/index.js'
import { patchCommand } from './commands/patch.js'
import { restoreCommand } from './commands/restore.js'
import { verifyCommand } from './commands/verify.js'
import { runCommand } from './commands/run.js'
import { statusCommand } from './commands/status.js'
import { supportsCommand } from './commands/supports.js'
import { setupCommand } from './commands/setup.js'
import { installCommand } from './commands/install.js'

const COMMANDS: Record<string, (args: string[]) => Promise<string | void>> = {
  patch: patchCommand,
  restore: async (_args) => restoreCommand(),
  verify: async (_args) => verifyCommand(),
  run: (args) => runCommand(args[0]),
  status: async (_args) => statusCommand(),
  supports: supportsCommand,
  setup: setupCommand,
  install: installCommand,
}

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
  const [cmd, ...args] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    showHelp()
    return
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log(getVersion())
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    console.error(`Unknown command: ${cmd}`)
    showHelp()
    process.exit(1)
  }

  try {
    const output = await handler(args)
    if (typeof output === 'string') {
      console.log(output)
    }
  } catch (error) {
    if (error instanceof CcxError) {
      console.error(`\n❌ Error [${error.code}]: ${error.message}`)
      if (error.suggestion) {
        console.error(`💡 ${error.suggestion}`)
      }
    } else {
      console.error('\n❌ Unexpected error:', error)
    }
    process.exit(1)
  }
}

function showHelp(): void {
  console.log(`
cc-expand — Expand Claude Code's context window

Usage:
  cc-expand <command> [options]

Commands:
  install [ver]    Download Claude Code via npm
  patch            Patch local Claude Code binary
  restore          Restore original binary
  verify           Check patch status
  run [tokens]     Launch patched Claude Code
  status           Show current status
  supports         List supported Claude Code versions
  setup            Install shell shortcuts (cc, c)

Examples:
  cc-expand install 2.1.170
  cc-expand patch --target 256000
  cc-expand run 256000
  cc-expand setup --yes
`)
}

main()
