#!/usr/bin/env node
// install.js — Interactive one-command setup for cc-expand (cross-platform)

const { execFileSync, execSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const readline = require('node:readline')

const DEFAULT_TARGET = '270000'
const DEFAULT_VERSION = 'latest'

// Colors
const R = '\x1b[0;31m'
const G = '\x1b[0;32m'
const Y = '\x1b[1;33m'
const B = '\x1b[0;34m'
const C = '\x1b[0;36m'
const X = '\x1b[0m'

function step(msg) { console.log(`\n${B}==>${X} ${msg}`) }
function ok(msg) { console.log(`   ${G}✓${X} ${msg}`) }
function fail(msg) { console.log(`   ${R}✗${X} ${msg}`) }
function warn(msg) { console.log(`   ${Y}⚠${X} ${msg}`) }

function parseArgs(argv) {
  let target = process.env.CC_EXPAND_TARGET || DEFAULT_TARGET
  let version = process.env.CC_EXPAND_VERSION || DEFAULT_VERSION
  let yes = false
  let skipSetup = false

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target' || arg === '-t') {
      target = argv[++i]
    } else if (arg === '--version' || arg === '-v') {
      version = argv[++i]
    } else if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--skip-setup') {
      skipSetup = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node install.js [options]')
      console.log('')
      console.log('Options:')
      console.log('  -t, --target <n>    Target context window (default: 270000)')
      console.log('  -v, --version <v>   Claude Code version (default: latest)')
      console.log('  -y, --yes           Skip all prompts (non-interactive mode)')
      console.log('  --skip-setup        Do not install shell integration')
      console.log('')
      console.log('Environment variables:')
      console.log('  CC_EXPAND_TARGET    Set default target (overridden by --target)')
      console.log('  CC_EXPAND_VERSION   Set default version (overridden by --version)')
      process.exit(0)
    } else if (arg.startsWith('-')) {
      console.log(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }

  return { target, version, yes, skipSetup }
}

function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function askTarget() {
  console.log('\nChoose your context window size:')
  console.log(`  ${C}[1]${X} 200k — Restore to default (no expansion)`)
  console.log(`  ${C}[2]${X} 250k — Safe expansion`)
  console.log(`  ${C}[3]${X} 270k — Aggressive expansion (recommended)`)

  const answer = await askQuestion('Enter 1, 2, or 3 [3]: ')
  switch (answer) {
    case '1': return '200000'
    case '2': return '250000'
    case '3': case '': return DEFAULT_TARGET
    default: return answer || DEFAULT_TARGET
  }
}

async function askSetup() {
  console.log('\nShell integration:')
  console.log('  This will add a cc() function and c alias to your shell config (~/.zshrc or ~/.bashrc).')
  console.log('  After setup, you can type cc or c to launch Claude Code with expanded context.')
  console.log('  Without it, you will need to run cc-expand run <tokens> each time.')

  const answer = await askQuestion('Install shell integration? [Y/n]: ')
  return answer === '' || answer.toLowerCase() === 'y'
}

function checkNodeJs() {
  step('Checking prerequisites')

  let nodeVersion
  try {
    nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf-8' }).trim()
  } catch {
    fail('Node.js not found')
    console.log('   Install: https://nodejs.org/')
    process.exit(1)
  }

  const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10)
  if (major < 18) {
    fail(`Node.js ${nodeVersion} is too old (>= 18 required)`)
    process.exit(1)
  }

  ok(`Node.js ${nodeVersion}`)
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function findPatternsJson() {
  const scriptDir = join(__dirname)
  const candidates = [
    join(scriptDir, 'src', 'data', 'patterns.json'),
    join(scriptDir, 'dist', 'data', 'patterns.json'),
  ]

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  try {
    const globalRoot = execSync(`${getNpmCommand()} root -g`, { encoding: 'utf-8' }).trim()
    const globalCandidates = [
      join(globalRoot, 'cc-expand', 'src', 'data', 'patterns.json'),
      join(globalRoot, 'cc-expand', 'dist', 'data', 'patterns.json'),
    ]
    for (const c of globalCandidates) {
      if (existsSync(c)) return c
    }
  } catch { /* ignore */ }

  return null
}

function checkVersionCompatibility(version) {
  if (version === 'latest') return

  const patternsPath = findPatternsJson()
  if (!patternsPath) {
    warn('Could not verify version compatibility — will check during patch')
    return
  }

  step('Checking version compatibility')

  const patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'))
  const cfg = patterns[version]

  if (!cfg) {
    const supported = Object.keys(patterns).sort().join(', ')
    fail(`Claude Code ${version} is not supported`)
    console.log(`   Supported versions: ${supported}`)
    process.exit(1)
  }

  const osPatterns = cfg.platforms[process.platform]
  if (!osPatterns || !osPatterns[process.arch]) {
    const platforms = Object.entries(cfg.platforms)
      .flatMap(([os, archMap]) => Object.keys(archMap).map(a => `${os}-${a}`))
    fail(`Claude Code ${version} not available for ${process.platform}-${process.arch}`)
    console.log(`   Available platforms: ${platforms.join(', ')}`)
    process.exit(1)
  }

  ok(`Version ${version} is supported on ${process.platform}-${process.arch}`)
}

function installCcExpand() {
  step('Installing cc-expand')

  try {
    execFileSync('cc-expand', ['--version'], { stdio: 'ignore' })
    ok('cc-expand already installed')
    return
  } catch { /* not installed */ }

  execFileSync(getNpmCommand(), ['install', '-g', 'cc-expand'], { stdio: 'inherit' })
  ok('cc-expand installed')
}

function installClaudeCode(version) {
  step(`Installing Claude Code ${version}`)
  execFileSync('cc-expand', ['install', version], { stdio: 'inherit' })
  ok('Claude Code installed')
}

function patchClaudeCode(target, version) {
  if (target === '200000') {
    step('Skipping patch (default 200k context window)')
    return
  }

  step(`Patching to ${target} tokens`)
  const args = ['patch', '--target', target, '--yes']
  if (version !== 'latest') {
    args.push('--version', version)
  }
  execFileSync('cc-expand', args, { stdio: 'inherit' })
  ok(`Patched to ${target} tokens`)
}

function setupShell() {
  step('Setting up shell integration')
  try {
    execFileSync('cc-expand', ['setup', '--yes'], { stdio: 'inherit' })
    ok('Shell integration installed')
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message || '')
    if (msg.includes('already installed')) {
      ok('Shell integration already installed')
      return
    }
    throw err
  }
}

async function main() {
  const { target, version, yes, skipSetup } = parseArgs(process.argv)
  const isInteractive = process.stdin.isTTY && !yes

  let finalTarget = target
  let shouldSetup = false

  checkNodeJs()

  if (isInteractive) {
    finalTarget = await askTarget()
    if (!skipSetup) {
      shouldSetup = await askSetup()
    }
  } else {
    // Non-interactive mode: skip setup by default unless explicitly requested
    shouldSetup = !skipSetup && (process.env.CC_EXPAND_SETUP === '1' || process.env.CC_EXPAND_SETUP === 'true')
  }

  checkVersionCompatibility(version)
  installCcExpand()
  installClaudeCode(version)
  patchClaudeCode(finalTarget, version)

  if (shouldSetup) {
    setupShell()
  }

  console.log(`\n${G}Done!${X}`)
  if (shouldSetup) {
    console.log(`Run ${C}cc${X} or ${C}c${X} to start Claude Code with ${C}${finalTarget}${X} tokens`)
    if (process.platform === 'win32') {
      console.log(`Reload your profile: ${C}. $PROFILE${X}`)
    } else {
      console.log(`Restart your terminal or run: ${C}source ~/.zshrc${X}`)
    }
  } else {
    console.log(`Run ${C}cc-expand run ${finalTarget}${X} to start with expanded context`)
    console.log(`Or run ${C}cc-expand setup --yes${X} to install shell shortcuts (cc, c)`)
  }
}

main().catch((err) => {
  console.error(`\n${R}Error:${X}`, err.message)
  process.exit(1)
})
