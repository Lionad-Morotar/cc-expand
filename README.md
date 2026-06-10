<p align="center">
  <img src="https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610143352565.webp" width="160" alt="cc-expand logo">
</p>

<h1 align="center">cc-expand</h1>

<p align="center">
  Expand Claude Code's context window — break through the 200K hard limit.
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a>
</p>

---

Expand Claude Code's context window — from 200K to any value.

When using a model that supports 256K context, Claude Code's native 200K limit becomes a bottleneck. `cc-expand` patches the Claude Code binary to raise this limit to your target value.

## Install

```bash
npm install -g cc-expand
```

Or use npx without installing:

```bash
npx cc-expand <command>
```

Or run the installer for one-command setup:

```bash
curl -fsSL https://raw.githubusercontent.com/Lionad-Morotar/cc-expand/main/install.sh | bash
```

With options:
```bash
curl -fsSL https://raw.githubusercontent.com/Lionad-Morotar/cc-expand/main/install.sh | bash -s -- --target 256000 --version 2.1.170
```

## Usage

### Interactive patch

```bash
cc-expand patch
# Prompts for target tokens, confirms, then patches
```

### Non-interactive patch (CI / scripts)

```bash
cc-expand patch --target 256000 --yes
```

> **Tip:** Claude Code respects the `COMPACT_WINDOW` env var, but it cannot exceed the hardcoded default. Raising the target delays compression. For example, Kimi-K2.6 supports 256K; I set my target to 270000.

![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610105949399.png)

### Verify patch status

```bash
cc-expand verify
```

### Restore original binary

```bash
cc-expand restore
```

### Show status

```bash
cc-expand status
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `patch [options]` | Patch the Claude Code binary |
| `restore` | Restore original binary from backup |
| `verify` | Check whether the binary is patched |
| `status` | Show version and patch status |

### Patch Options

```
-t, --target <number>   Target context window size (default: 256000)
-y, --yes               Skip confirmation prompt
```

## Supported Versions

| Version | darwin-arm64 | darwin-x64 | win32-x64 | linux-arm64 | linux-x64 |
|---------|:------------:|:----------:|:---------:|:-----------:|:---------:|
| 2.1.161 | ✅ | — | — | — | — |
| 2.1.162 | ✅ | — | — | — | — |
| 2.1.163 | ✅ | — | — | — | — |
| 2.1.169 | ✅ | ✅ | ✅ | — | — |
| 2.1.170 | ✅ | ✅ | ✅ | — | — |

> ⚠️  Version numbers match `claude --version`. If `patch` reports an unsupported version, upgrade to a supported release or open an issue.

## How it works

The Claude Code binary contains hard-coded model constants set to `200000`. Each release uses different obfuscated variable names, and each platform/architecture uses its own names.

`cc-expand` follows this pipeline:

1. **Discover** — Locates the Claude Code binary (`/usr/local/bin/claude` or npm global path)
2. **Identify version** — Reads `claude --version`
3. **Match patterns** — Looks up pre-built patch patterns by `version + platform + arch`
4. **Backup** — Copies the original binary to `~/.cc-expand/backups/`
5. **Patch** — Replaces constants in-place (file size unchanged)
6. **Re-sign** — macOS: `codesign --sign - --force --deep`
7. **Verify** — Confirms original patterns are gone and target values are written
8. **Rollback** — Auto-restores from backup if verification fails

## Notes

- **macOS**: Re-signs automatically after patching. If codesign fails, the binary may not run; use `restore` to recover.
- **Windows**: No extra steps; `claude.exe` is replaced directly.
- **Linux**: Not yet supported (need binary samples, PRs welcome).
- **Digit limit**: Target must have the same digit count as the original (`200000` → `256000`, both 6 digits). A mismatch produces an error.

## FAQ

**Claude Code won't start after patching**

Run `cc-expand restore`, then check:
- Was codesign successful on macOS?
- Does the target value have the same digit count?
- Is the version supported?

**Version not supported**

```
No pattern found for version 2.1.xxx
```

Either upgrade to a supported version, or discover new patterns and submit a PR.

**How to discover new patterns**

For a known version on a new platform/arch:

```bash
grep -ao '.{0,25}200000.{0,15}' /path/to/claude | grep '=200000'
```

## License

MIT © Lionad Morotar
