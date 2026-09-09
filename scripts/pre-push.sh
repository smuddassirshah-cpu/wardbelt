#!/usr/bin/env bash
# Decision notes: the stage 8 pre-push gate (PLAN.md section 11). Runs every check the CI
# workflow runs plus the ones CI cannot: the secrets scan over the full history and a clean
# clone that must install, build and test from the committed tree alone. Steps call the
# existing scripts rather than repeating their logic. The e2e step refuses to run while
# something is already listening on the preview port, so Playwright always builds and serves a
# fresh bundle instead of testing a stale one. Stops at the first failure and prints a summary
# either way. Usage: scripts/pre-push.sh (or install it as a git pre-push hook; see README).
# Environment: WARDBELT_TMP overrides the directory the clean clone is made in.
# ROOT comes from git, not from this file's path: installed as a hook the script is a symlink
# under .git/hooks or core.hooksPath, and git runs hooks from the top of the working tree.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

PREVIEW_PORT=4173
STEPS=()
GATE_START=$(date +%s)
CLONE_DIR=""
TMP_PARENT=""

print_summary() {
  local total=$(( $(date +%s) - GATE_START ))
  printf '\n==== pre-push summary (%s, HEAD %s) ====\n' "$(basename "$ROOT")" "$(git rev-parse --short HEAD)"
  local line
  for line in "${STEPS[@]}"; do
    printf '%s\n' "$line"
  done
  printf 'total %d s\n' "$total"
}

cleanup() {
  if [[ -n "$CLONE_DIR" && -d "$CLONE_DIR" ]]; then
    rm -rf "$CLONE_DIR"
  fi
  if [[ -n "$TMP_PARENT" && -d "$TMP_PARENT" ]]; then
    rmdir "$TMP_PARENT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

step() {
  local name="$1"
  shift
  local started
  started=$(date +%s)
  printf '\n==> %s\n' "$name"
  if "$@"; then
    STEPS+=("PASS  $name ($(( $(date +%s) - started )) s)")
  else
    STEPS+=("FAIL  $name ($(( $(date +%s) - started )) s)")
    print_summary
    printf '\npre-push gate RED: %s failed\n' "$name" >&2
    exit 1
  fi
}

port_free() {
  node --input-type=module -e "
    import net from 'node:net';
    const server = net.createServer();
    server.once('error', () => {
      process.stderr.write('port $PREVIEW_PORT is in use: stop the stale preview server so Playwright can start a fresh one\n');
      process.exit(1);
    });
    server.listen($PREVIEW_PORT, '127.0.0.1', () => server.close());
  "
}

secrets_scan() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    printf 'gitleaks is not installed (brew install gitleaks, or see https://github.com/gitleaks/gitleaks)\n' >&2
    return 1
  fi
  gitleaks detect --source . --no-banner
}

clean_clone() {
  local base
  if [[ -n "${WARDBELT_TMP:-}" ]]; then
    base="$WARDBELT_TMP"
  else
    base="$(mktemp -d)"
    TMP_PARENT="$base"
  fi
  CLONE_DIR="$base/wardbelt-clean-clone"
  rm -rf "$CLONE_DIR"
  if [[ -n "$(git status --porcelain)" ]]; then
    printf 'note: the working tree has uncommitted changes; the clone tests HEAD only\n'
  fi
  git clone --quiet "$ROOT" "$CLONE_DIR"
  printf 'cloned %s into %s\n' "$(git -C "$CLONE_DIR" rev-parse --short HEAD)" "$CLONE_DIR"
  (cd "$CLONE_DIR" && npm ci --no-audit --no-fund && npm run build && npm test)
}

step "preview port $PREVIEW_PORT is free" port_free
step "npm run lint" npm run lint
step "npm run typecheck" npm run typecheck
step "npm test" npm test
step "npm run build" npm run build
step "bundle size (scripts/bundle-size.mjs)" node scripts/bundle-size.mjs --no-build
step "hardening checks (scripts/hardening.mjs)" node scripts/hardening.mjs --no-build
step "Pages base path (scripts/check-base-path.mjs)" node scripts/check-base-path.mjs
step "npm run test:e2e" npm run test:e2e
step "gitleaks detect (full history)" secrets_scan
step "clean clone: npm ci, build, test" clean_clone

print_summary
printf '\npre-push gate GREEN\n'
