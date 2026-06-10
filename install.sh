#!/usr/bin/env bash
set -euo pipefail

# cc-expand install.sh — One-command setup

TARGET="270000"
CC_VERSION="latest"

# Colors
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; X='\033[0m'

step() { echo -e "\n${B}==>${X} $1"; }
ok()   { echo -e "   ${B}✓${X} $1"; }
fail() { echo -e "   ${R}✗${X} $1"; }
warn() { echo -e "   ${Y}⚠${X} $1"; }

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target|-t)  TARGET="$2"; shift 2 ;;
    --version|-v) CC_VERSION="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: install.sh [options]"
      echo "  -t, --target <n>   Target context window (default: 270000)"
      echo "  -v, --version <v>  Claude Code version (default: latest)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Find patterns.json: local repo first, then global install
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PATTERNS=""
for candidate in "$SCRIPT_DIR/src/data/patterns.json" "$SCRIPT_DIR/dist/data/patterns.json"; do
  if [[ -f "$candidate" ]]; then
    PATTERNS="$candidate"
    break
  fi
done

# If not found locally, try global npm package
if [[ -z "$PATTERNS" ]]; then
  GLOBAL_ROOT=$(npm root -g 2>/dev/null || true)
  if [[ -n "$GLOBAL_ROOT" ]]; then
    for candidate in "$GLOBAL_ROOT/cc-expand/src/data/patterns.json" "$GLOBAL_ROOT/cc-expand/dist/data/patterns.json"; do
      if [[ -f "$candidate" ]]; then
        PATTERNS="$candidate"
        break
      fi
    done
  fi
fi

# Version compatibility pre-check
if [[ "$CC_VERSION" != "latest" && -n "$PATTERNS" ]]; then
  step "Checking version compatibility"
  RESULT=$(node -e "
    const data = require('$PATTERNS');
    const v = '$CC_VERSION';
    const plat = process.platform;
    const arch = process.arch;
    const cfg = data[v];
    if (!cfg) {
      const supported = Object.keys(data).sort().join(', ');
      console.log('UNSUPPORTED_VERSION:' + supported);
      process.exit(0);
    }
    const osPatterns = cfg.platforms[plat];
    if (!osPatterns || !osPatterns[arch]) {
      const platforms = Object.entries(cfg.platforms).flatMap(([os, a]) => Object.keys(a).map(ar => os + '-' + ar));
      console.log('UNSUPPORTED_PLATFORM:' + platforms.join(', '));
      process.exit(0);
    }
    console.log('OK');
  " 2>/dev/null) || RESULT="CHECK_FAILED"

  case "$RESULT" in
    UNSUPPORTED_VERSION:*)
      fail "Claude Code $CC_VERSION is not supported"
      echo "   Supported versions: ${RESULT#UNSUPPORTED_VERSION:}"
      exit 1
      ;;
    UNSUPPORTED_PLATFORM:*)
      fail "Claude Code $CC_VERSION not available for $(uname -sm)"
      echo "   Available platforms: ${RESULT#UNSUPPORTED_PLATFORM:}"
      exit 1
      ;;
    CHECK_FAILED)
      warn "Could not verify version compatibility — will check during patch"
      ;;
    OK)
      ok "Version $CC_VERSION is supported on $(uname -sm)"
      ;;
  esac
fi

# Step 1: Check Node.js >= 18
step "Checking prerequisites"
if ! command -v node &> /dev/null; then
  fail "Node.js not found"
  echo "   Install: https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  fail "Node.js $(node --version) is too old (>= 18 required)"
  exit 1
fi
ok "Node.js $(node --version)"

# Step 2: Install cc-expand
step "Installing cc-expand"
if command -v cc-expand &> /dev/null; then
  ok "cc-expand already installed"
else
  npm install -g cc-expand
  ok "cc-expand installed"
fi

# Step 3: Install Claude Code
step "Installing Claude Code ${CC_VERSION}"
cc-expand install "$CC_VERSION"
ok "Claude Code installed"

# Step 4: Patch
step "Patching to ${TARGET} tokens"
cc-expand patch --target "$TARGET" --version "$CC_VERSION" --yes
ok "Patched to ${TARGET} tokens"

# Step 5: Shell setup
step "Setting up shell integration"
cc-expand setup --yes
ok "Shell integration installed"

# Done
echo -e "\n${G}Done!${X} Run '${C}cc${X}' or '${C}c${X}' to start Claude Code with ${C}${TARGET}${X} tokens"
echo -e "   Restart terminal or run: ${C}source ~/.zshrc${X}"
