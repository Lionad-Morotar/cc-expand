<p align="center">
  <img src="https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610223551529.webp" width="800" alt="cc-expand logo">
</p>

<h1 align="center">cc-expand</h1>

<p align="center">
  <span>Resize your CC's context window freely</span>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a>
</p>

---

Model performance degrades for two main reasons: auto-compaction and long context. cc-expand lets you resize the context window to sidestep both:

1. **Break through the 200K context window limit to delay auto-compaction**: When using certain models (which only support 256K context), Claude Code's native 200K limit becomes a bottleneck. `cc-expand` patches the hard-coded constants in the Claude Code binary to raise the context window size to your target value.
2. **Cap 1M models at 500K to stay in the optimal performance range**: Performance drops noticeably past 256K and 512K.

Details below.

First, performance degradation over long contexts. Image from the mimo-v2.5 pro blog.

![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260614013032076.png)

Claude Code's environment variable allows setting `COMPACT_WINDOW`, but it cannot exceed the hard-coded default. So raising the target delays compression. For example, the Kimi-K2.6 I use daily supports 256K, so I set my target to 270000 to push compression from around 17K to 23K.

| Before | After |
|--------|-------|
| 200K limit, ~110K free context | 270K limit, ~180K free context |
| ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211249243.png) | ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211422491.png) |

## Install

Ask your AI agent to run this:

```plaintext
Help me expand Claude Code's context window to 270k using cc-expand (npx -y cc-expand@latest)
```

Or **install manually**:

```bash
# use npm
npm install -g cc-expand
# or npx
npx cc-expand <command>
```

## Features

* Supports both Mac and Windows
* Fully compatible — allows setting any context size without sacrificing the auto-compaction feature, so both expanding and shrinking the context window are supported

## Usage

| Command | Description |
|---------|-------------|
| `cc-expand install [version]` | Download Claude Code from npm to `~/.cc-expand/packages/` |
| `cc-expand patch [options]` | Copy binary from local package, patch it, and save to `~/.cc-expand/bin/` |
| `cc-expand run [tokens]` | Launch the patched Claude Code binary |
| `cc-expand setup` | Install shell shortcuts (`cc`, `c` aliases for quickly opening the patched Claude Code) |
| `cc-expand restore` | Restore original binary from backup |
| `cc-expand verify` | Verify whether the binary has been patched |
| `cc-expand status` | Show version and patch status |
| `cc-expand supports` | List supported Claude Code versions |
| `cc-expand --version` | Show cc-expand version |

* install version option: `latest` or `v2.1.170`
* token counts accept plain numbers, `k` for thousands, or `w` for ten-thousands:
  `256000`, `256,000`, `270k`, and `27w` all mean 270000 tokens
* patch options:
  ```
  -t, --target <count>    Target context window size (default: 256000)
  -v, --version <semver>  Claude Code version to patch (e.g. 2.1.170)
  -y, --yes               Skip confirmation and overwrite shell shortcuts
  ```
* After `patch` succeeds, cc-expand automatically maintains the `cc`/`c` shell shortcuts so their default target matches the patched value.
* `run` also accepts the same token shorthand, e.g. `cc-expand run 270k`.

## Supported CC Versions

| Version | darwin-arm64 | darwin-x64 | win32-x64 | linux-arm64 | linux-x64 |
|---------|:------------:|:----------:|:---------:|:-----------:|:---------:|
| 2.1.161 | ✅ | — | — | — | — |
| 2.1.162 | ✅ | — | — | — | — |
| 2.1.163 | ✅ | — | — | — | — |
| 2.1.169 | ✅ | ✅ | ✅ | — | — |
| 2.1.170 | ✅ | ✅ | ✅ | — | — |
| 2.1.172 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.1.173 | ✅ | ✅ | ✅ | ✅ | ✅ |

> ⚠️ cc-expand version numbers correspond to `claude --version`. Run `cc-expand supports` to see the dynamically updated list of CC versions supported by cc-expand.

**Version Update Mechanism**

Patterns are hosted on Aliyun OSS and fetched on-demand when you run cc-expand. They are cached locally under `~/.cc-expand/cache/patterns/` with ETag conditional requests to minimize bandwidth.

Every half hour, my claw automatically runs the `watch-patch` skill to discover new Claude Code versions, extract their obfuscated variable names, and upload pattern shards to OSS. You don't need to update the `cc-expand` npm package to get new version support — new patterns are available immediately after OSS upload.

But my claw crashes in many situations. If you encounter a version newer than what cc-expand supports, please use an older CC version for a moment (e.g. `npx @anthropic-ai/claude-code@2.1.148`).

Advanced users can also ask your Agent:

```plaintext
I need to update my CC context window size, but cc-expand doesn't support the version I'm using yet.
You need to pull the source code of this project, read `<project-root>/.claude/skills/watch-patch` to understand the algorithm, and patch it.
Finally, set my CC to 270K context size.
```

## Support Me

Please star to support me in developing more interesting apps.

## License

MIT © Lionad Morotar
