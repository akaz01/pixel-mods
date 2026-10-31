#!/usr/bin/env bash
# pixel-mods installer for macOS (and other bash shells).
# Asks which version to install, Windows or macOS, then installs its four mods at user scope
# and removes the other version's four, since both sets together clash on /board and the rest.
#
#   bash install.sh            ask, then install
#   bash install.sh --dry-run  ask, then only print the commands
#   PIXEL_MODS_VERSION=2 bash install.sh   skip the question (1 Windows, 2 macOS)
set -euo pipefail

readonly MARKETPLACE_REPO="akaz01/pixel-mods"
readonly MARKETPLACE="pixel-mods"
readonly MODS=(work-board agent-router collab-hub safe-shell)

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi
}

# A step that may fail harmlessly, such as removing a mod that is not installed.
run_quietly() {
  if $DRY_RUN; then echo "  [dry-run] $*"; else "$@" >/dev/null 2>&1 || true; fi
}

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code (claude) is not installed or not on PATH. Install it first." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) detected=2 ;;
  *) detected=1 ;;
esac

echo "Which version of pixel-mods should be installed?"
echo "  1) Windows"
echo "  2) macOS"
# Read from the terminal, so the question still works when the script is piped in.
if [ -n "${PIXEL_MODS_VERSION:-}" ]; then
  choice="$PIXEL_MODS_VERSION"
  echo "Choice from PIXEL_MODS_VERSION: $choice"
elif [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
  read -r -p "Choose 1 or 2 [${detected}]: " choice </dev/tty || choice=""
else
  choice=""
fi
choice="${choice:-$detected}"

case "$choice" in
  1) install_suffix="";       remove_suffix="-macos"; label="Windows" ;;
  2) install_suffix="-macos"; remove_suffix="";       label="macOS" ;;
  *) echo "Please choose 1 or 2." >&2; exit 2 ;;
esac

echo
echo "Installing the ${label} version."

echo "- Marketplace"
if claude plugin marketplace list 2>/dev/null | grep -q "$MARKETPLACE"; then
  run claude plugin marketplace update "$MARKETPLACE"
else
  run claude plugin marketplace add "$MARKETPLACE_REPO"
fi

echo "- Removing the other version, if installed"
for mod in "${MODS[@]}"; do
  run_quietly claude plugin uninstall "${mod}${remove_suffix}@${MARKETPLACE}" --scope user
done

echo "- Installing"
for mod in "${MODS[@]}"; do
  run claude plugin install "${mod}${install_suffix}@${MARKETPLACE}" --scope user
done

echo
if $DRY_RUN; then
  echo "Dry run only: nothing was installed."
else
  echo "Done. Open a new Claude Code session: the Work Board opens by itself."
fi
