#!/usr/bin/env node
// install.js — One-command setup for cc-expand (cross-platform)

const { execFileSync, execSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

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
  let target = DEFAULT_TARGET
  let version = DEFAULT_VERSION

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target' || arg === '-t') {
      target = argv[++i]
    } else if (arg === '--version' || arg === '-v') {
      version = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node install.js [options]')
      console.log('  -t, --target <n>   Target context window (default: 270000)')
      console.log('  -v, --version <v>  Claude Code version (default: latest)')
      process.exit(0)
    } else if (arg.startsWith('-')) {
      console.log(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }

  return { target, version }
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

function findPatternsJson() {
  const scriptDir = join(__dirname)
  const candidates = [
    join(scriptDir, 'src', 'data', 'patterns.json'),
    join(scriptDir, 'dist', 'data', 'patterns.json'),
  ]

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  // Fallback: global npm package
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim()
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

  execFileSync('npm', ['install', '-g', 'cc-expand'], { stdio: 'inherit' })
  ok('cc-expand installed')
}

function installClaudeCode(version) {
  step(`Installing Claude Code ${version}`)
  execFileSync('cc-expand', ['install', version], { stdio: 'inherit' })
  ok('Claude Code installed')
}

function patchClaudeCode(target, version) {
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
  execFileSync('cc-expand', ['setup', '--yes'], { stdio: 'inherit' })
  ok('Shell integration installed')
}

function main() {
  const { target, version } = parseArgs(process.argv)

  checkNodeJs()
  checkVersionCompatibility(version)
  installCcExpand()
  installClaudeCode(version)
  patchClaudeCode(target, version)
  setupShell()

  console.log(`\n${G}Done!${X} Run '${C}cc${X}' or '${C}c${X}' to start Claude Code with ${C}${target}${X} tokens`)
  console.log(`   Restart terminal or run: ${C}source ~/.zshrc${X}`)
}

main()
