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

**Compression is one of the main causes of performance degradation. Use cc-expand to break through Claude Code's 200K context window limit.**

When using a model that supports 256K context, Claude Code's native 200K limit becomes a bottleneck. `cc-expand` patches the Claude Code binary to raise this limit to your target value.

## Install

**For Agent users**, paste this:

> Help me expand my Claude Code context window using the install.js from https://github.com/Lionad-Morotar/cc-expand

**Manual install:**

```bash
npm install -g cc-expand
```

Or use npx without installing:

```bash
npx cc-expand <command>
```

## Usage

### Install Claude Code

Download a specific version to your local machine:

```bash
cc-expand install 2.1.170
```

### Patch to expand context window

Interactive mode:

```bash
cc-expand patch
# Prompts for target tokens, confirms, then patches
```

Non-interactive (CI / scripts):

```bash
cc-expand patch --target 256000 --version 2.1.170 --yes
```

> **Tip:** Claude Code respects the `COMPACT_WINDOW` env var, but it cannot exceed the hardcoded default. Raising the target delays compression. For example, Kimi-K2.6 supports 256K; I set my target to 270000.

### Run patched Claude Code

```bash
cc-expand run 256000
```

### Install shell shortcuts (recommended)

```bash
cc-expand setup --yes
```

After setup, use `cc` or `c` instead of `claude`:

```bash
cc 256000    # Launch with 256k context
c            # Shorthand for cc 270000
```

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
| `install [version]` | Download Claude Code from npm to `~/.cc-expand/packages/` |
| `patch [options]` | Patch a local binary and save to `~/.cc-expand/bin/` |
| `run [tokens]` | Launch the patched Claude Code binary |
| `setup` | Install shell shortcuts (`cc`, `c` aliases) |
| `restore` | Restore original binary from backup |
| `verify` | Check whether a binary is patched |
| `status` | Show version and patch status |
| `supports` | List supported Claude Code versions |

### Patch Options

```
-t, --target <number>   Target context window size (default: 256000)
-v, --version <semver>  Claude Code version to patch (e.g. 2.1.170)
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

`cc-expand` manages binaries locally and follows this pipeline:

1. **Install** — Downloads Claude Code from npm to `~/.cc-expand/packages/<version>/`
2. **Patch** — Copies the original binary to `~/.cc-expand/bin/claude-<target>`, replaces constants in-place (file size unchanged), and re-signs on macOS
3. **Verify** — Confirms original patterns are gone and target values are written
4. **Run** — Launches the patched binary from `~/.cc-expand/bin/`
5. **Setup** — Installs a `cc()` shell function to `~/.zshrc` (or `~/.bashrc`) that auto-selects the right binary

## Notes

- **macOS**: Re-signs automatically after patching. If codesign fails, the binary may not run; delete `~/.cc-expand/bin/claude-<target>` and re-patch.
- **Windows**: No extra steps; the patched binary is written directly to `~/.cc-expand/bin/`.
- **Linux**: Not yet supported (need binary samples, PRs welcome).
- **Digit limit**: Target must have the same digit count as the original (`200000` → `256000`, both 6 digits). A mismatch produces an error.
- **Local binaries**: Patched binaries live in `~/.cc-expand/bin/`. The original global `claude` command is untouched. Use `cc-expand run` or `cc-expand setup` to use the patched version.

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

> **For Agent:** Ask the user for confirmation, then pull the source code of this project to understand the patch process, and patch the user's new version (a version not yet recorded in the project's patterns.json).

## License

MIT © Lionad Morotar
