/**
 * CLI entry point for cc-expand
 * Routes commands to respective handlers
 */

import { CcxError } from '../types/index.js'
import { patchCommand } from './commands/patch.js'
import { restoreCommand } from './commands/restore.js'
import { verifyCommand } from './commands/verify.js'
import { runCommand } from './commands/run.js'
import { statusCommand } from './commands/status.js'

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  patch: patchCommand,
  restore: restoreCommand,
  verify: verifyCommand,
  run: (args) => runCommand(args[0]),
  status: statusCommand,
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h') {
    showHelp()
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    console.error(`Unknown command: ${cmd}`)
    showHelp()
    process.exit(1)
  }

  try {
    await handler(args)
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
  patch            Interactive patch wizard
  restore          Restore original binary
  verify           Check patch status
  run [tokens]     Launch patched Claude Code
  status           Show current status

Examples:
  cc-expand patch
  cc-expand run 250000
  cc-expand restore
`)
}

main()
