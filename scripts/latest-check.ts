#!/usr/bin/env node
/**
 * 检查 npm latest Claude Code 版本,对比本地 versions.json,输出结构化结果
 * 用法: pnpm pattern:latest-check
 *
 * 输出 JSON(stdout): { latest, processed, needWork }
 * needWork 时额外 stderr 提示下一步命令
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { LatestChecker } from '../src/services/latest-checker.js'

// 绕过 npmmirror 缓存,直查官方 registry,避免版本同步延迟
const npmView = spawnSync(
  'npm',
  ['view', '@anthropic-ai/claude-code', 'version', '--registry', 'https://registry.npmjs.org'],
  { encoding: 'utf-8' },
)
if (npmView.status !== 0) {
  console.error('npm view 失败:', npmView.stderr)
  process.exit(1)
}
const latest = npmView.stdout.trim().split('\n').pop() as string

const versionsPath = join(process.cwd(), 'patterns', 'versions.json')
const localVersions: string[] = existsSync(versionsPath)
  ? (JSON.parse(readFileSync(versionsPath, 'utf8')) as { version: string }[]).map((v) => v.version)
  : []

const result = new LatestChecker().check(latest, localVersions)
console.log(JSON.stringify(result))
if (result.needWork) {
  console.error(`\n新版本 ${latest} 需生成 pattern: pnpm pattern:gen ${latest}`)
}
