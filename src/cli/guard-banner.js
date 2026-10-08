/**
 * dist/cli.js 的 banner 守卫（tsup banner 注入，位于一切 require 之前）
 *
 * Why: cli.js 的 shebang 是 `#!/usr/bin/env node`，env 按 PATH 解析，在声明了
 * .node-version / .nvmrc 的项目目录里会被 fnm use-on-cd 劫持到老版本 node；
 * 本 CLI 依赖链（cac 等）只发 ESM，require 它需要 require(esm) 特性
 * （v22 起 unflagged，v20.19 backport 默认启用），老 node 下直接
 * ERR_REQUIRE_ESM 崩溃，且报错落在 patch/install 子命令上，与真实根因相距甚远。
 *
 * 这里必须自包含（只 require node 内置），且守卫执行先于 bundle 的任何第三方
 * require——esbuild 会把 index.ts 的 import 统一提升为顶部 require 调用，
 * 任何以 import 形态接入的守卫都晚于 cac 的 require，只有 banner 能保证顺序。
 *
 * 版本判定等纯函数同时导出，供单测（require 本文件时顶层守卫在达标 node 上
 * 直接 return，无副作用）；作为 banner 注入 dist 后导出面会被 bundle 的
 * exports 覆盖，无碍。
 */

;(function () {
  var NODE_OK = supportsRequireEsm(process.version)
  if (NODE_OK) return

  var spawnSync = require('node:child_process').spawnSync
  var existsSync = require('node:fs').existsSync
  var realpathSync = require('node:fs').realpathSync
  var join = require('node:path').join

  var candidates = candidateNodePaths(process.env)
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i]
    if (!existsSync(candidate)) continue
    var probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 })
    if (probe.status !== 0) continue
    if (!supportsRequireEsm((probe.stdout || '').trim())) continue
    var result = spawnSync(
      candidate,
      [realpathSync(__filename)].concat(process.argv.slice(2)),
      { stdio: 'inherit', env: process.env },
    )
    process.exit(result.status == null ? 1 : result.status)
  }

  process.stderr.write(
    [
      'cc-expand: 当前 node ' + process.version + ' 不支持 require(esm)，CLI 无法运行。',
      '任选其一修复：',
      '  1. export CC_EXPAND_NODE=/path/to/node-v22+ 后重试',
      '  2. 在该目录把 node 切到 v20.19+ 或 v22+（如 fnm use）',
      '  3. 升级默认 node（如 fnm default <version>）',
    ].join('\n') + '\n',
  )
  process.exit(1)

  /** require(esm) 默认可用的最低版本判定 */
  function supportsRequireEsm(version) {
    var m = /^v(\d+)\.(\d+)\.(\d+)/.exec(version)
    if (!m) return false
    var major = +m[1]
    var minor = +m[2]
    if (major >= 22) return true
    if (major === 20) return minor >= 19
    return major > 22
  }

  /** 候选 node 查找序：显式环境变量优先，其次常见版本管理器 default 与系统安装位；存在性由消费方循环内筛 */
  function candidateNodePaths(env) {
    var list = []
    if (env && env.CC_EXPAND_NODE) list.push(env.CC_EXPAND_NODE)
    var home = require('node:os').homedir()
    // fnm default alias：mac 与 Linux 的 FNM_DIR 默认位各一，别名随用户升级走
    list.push(
      join(home, 'Library/Application Support/fnm/aliases/default/bin/node'),
      join(home, '.local/share/fnm/aliases/default/bin/node'),
      // volta 与常见系统安装位
      join(home, '.volta/bin/node'),
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
    )
    return list
  }
})()

/** 供单测导入的纯函数面（dist 内被 bundle exports 覆盖，无碍） */
module.exports = {
  supportsRequireEsm: function (version) {
    var m = /^v(\d+)\.(\d+)\.(\d+)/.exec(version)
    if (!m) return false
    var major = +m[1]
    var minor = +m[2]
    if (major >= 22) return true
    if (major === 20) return minor >= 19
    return major > 22
  },
  candidateNodePaths: function (env) {
    var join = require('node:path').join
    var list = []
    if (env && env.CC_EXPAND_NODE) list.push(env.CC_EXPAND_NODE)
    var home = require('node:os').homedir()
    list.push(
      join(home, 'Library/Application Support/fnm/aliases/default/bin/node'),
      join(home, '.local/share/fnm/aliases/default/bin/node'),
      join(home, '.volta/bin/node'),
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
    )
    return list
  },
}
