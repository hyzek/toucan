#!/bin/sh
# toucan installer: builds a channel (dev, nightly, or stable) from GitHub into
# TOUCAN_HOME (default ~/.toucan), installs the ~/.toucan/bin/toucan launcher, and
# adds it to PATH. Re-run to repair or update; `toucan install toucan:<name>` and
# `toucan update` do the same work from an installed toucan.
#
#   curl -fsSL https://raw.githubusercontent.com/hyzek/toucan/main/scripts/install.sh | sh
#   sh install.sh [channel]        # channel: stable (default), dev, or nightly
#
# Keep the build recipe in sync with installChannel in
# packages/coding-agent/src/core/channel-manager.ts.
set -eu

TOUCAN_HOME="${TOUCAN_HOME:-$HOME/.toucan}"
REPO_URL="${TOUCAN_REPO_URL:-https://github.com/hyzek/toucan.git}"
CHANNEL="${1:-stable}"

case "$CHANNEL" in
	dev | nightly | stable) ;;
	*)
		echo "install.sh: unknown channel '$CHANNEL' (use dev, nightly, or stable)." >&2
		exit 1
		;;
esac

need() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "install.sh: $1 is required but was not found on PATH." >&2
		exit 1
	}
}

need git
need node
need npm

BUILDS_DIR="$TOUCAN_HOME/builds"
BUILD_DIR="$BUILDS_DIR/$CHANNEL"
LAUNCHER="$TOUCAN_HOME/bin/toucan"
LOCK_DIR="$BUILDS_DIR/.$CHANNEL.installer.lock"
mkdir -p "$BUILDS_DIR/.tmp"

if [ -e "$LOCK_DIR" ]; then
	echo "install.sh: another channel operation for $CHANNEL is running ($LOCK_DIR exists)." >&2
	exit 1
fi
mkdir "$LOCK_DIR"
trap 'rm -rf "$LOCK_DIR" "$STAGE_DIR" "$OLD_DIR" 2>/dev/null || true' EXIT

echo "Fetching refs from $REPO_URL..."
if [ "$CHANNEL" = "stable" ]; then
	REF="$(git ls-remote --tags "$REPO_URL" 'refs/tags/b*' | sed -n 's|.*refs/tags/\(b[0-9][0-9]*\)$|\1|p' | sort -V | tail -n 1)"
	[ -n "$REF" ] || { echo "install.sh: no b<N> release tags found in $REPO_URL." >&2; exit 1; }
else
	REF="$CHANNEL"
	git ls-remote --exit-code "$REPO_URL" "refs/heads/$REF" >/dev/null 2>&1 || {
		echo "install.sh: branch $REF does not exist in $REPO_URL." >&2
		exit 1
	}
fi

STAGE_DIR="$(mktemp -d "$BUILDS_DIR/.tmp/$CHANNEL-installer-XXXXXX")"
OLD_DIR="$BUILD_DIR.old-installer"
COMMIT=""

echo "Cloning $REF into $BUILD_DIR..."
git clone --depth 1 --branch "$REF" "$REPO_URL" "$STAGE_DIR"

REQUIRED_NODE="$(sed -n 's/.*"node": *">=\([0-9][0-9.]*\)".*/\1/p' "$STAGE_DIR/package.json" | head -n 1)"
CURRENT_NODE="$(node -p 'process.version.slice(1)')"
if [ -n "$REQUIRED_NODE" ] && [ "$(printf '%s\n%s\n' "$REQUIRED_NODE" "$CURRENT_NODE" | sort -V | head -n 1)" != "$REQUIRED_NODE" ]; then
	echo "install.sh: this build requires Node >=$REQUIRED_NODE, but this is $CURRENT_NODE. Install a newer Node and retry." >&2
	exit 1
fi

echo "Installing dependencies..."
(cd "$STAGE_DIR" && npm ci --ignore-scripts)
for package in tui telemetry ai agent; do
	echo "Building packages/$package..."
	npm --prefix "$STAGE_DIR/packages/$package" run build
done
echo "Building the toucan CLI..."
npm --prefix "$STAGE_DIR/packages/coding-agent" run build

ENTRY="$STAGE_DIR/packages/coding-agent/dist/bundle/cli.js"
[ -f "$ENTRY" ] || { echo "install.sh: the build finished but dist/bundle/cli.js is missing." >&2; exit 1; }
COMMIT="$(git -C "$STAGE_DIR" rev-parse HEAD)"

node -e '
const [buildDir, channel, ref, commit, repoUrl] = process.argv.slice(1);
const fs = require("node:fs");
const info = {
	kind: "toucan-channel",
	schemaVersion: 1,
	channel,
	ref,
	commit,
	builtAt: new Date().toISOString(),
	node: process.version,
	repoUrl,
};
fs.writeFileSync(buildDir + "/channel.json", JSON.stringify(info, null, "\t") + "\n");
' "$STAGE_DIR" "$CHANNEL" "$REF" "$COMMIT" "$REPO_URL"

if [ -e "$BUILD_DIR" ]; then
	mv "$BUILD_DIR" "$OLD_DIR"
fi
mv "$STAGE_DIR" "$BUILD_DIR"
rm -rf "$OLD_DIR"

echo "Installing the launcher..."
TOUCAN_HOME="$TOUCAN_HOME" node "$BUILD_DIR/packages/coding-agent/dist/bundle/cli.js" launcher

if [ ! -f "$TOUCAN_HOME/channel" ]; then
	printf '%s\n' "$CHANNEL" >"$TOUCAN_HOME/channel"
fi

BIN_DIR="$TOUCAN_HOME/bin"
MARKER_BEGIN="# >>> toucan channel launcher >>>"
MARKER_END="# <<< toucan channel launcher <<<"
add_to_rc() {
	rc="$1"
	[ -f "$rc" ] || return 0
	if grep -qF "$MARKER_BEGIN" "$rc" 2>/dev/null; then return 0; fi
	printf '\n%s\nexport PATH="%s:$PATH"\n%s\n' "$MARKER_BEGIN" "$BIN_DIR" "$MARKER_END" >>"$rc"
	echo "Added the launcher to PATH in $rc."
}
FOUND_RC=0
for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
	if [ -f "$rc" ]; then
		FOUND_RC=1
		add_to_rc "$rc"
	fi
done
if [ "$FOUND_RC" -eq 0 ]; then
	add_to_rc "$HOME/.profile"
fi

if command -v toucan >/dev/null 2>&1 && [ "$(command -v toucan)" != "$LAUNCHER" ]; then
	echo "warning: '$(command -v toucan)' is earlier on your PATH than $LAUNCHER." >&2
	echo "warning: an npm or other installation may shadow the channel launcher." >&2
fi

echo
echo "Installed toucan $CHANNEL ($REF ${COMMIT%"${COMMIT#????????}"}) to $BUILD_DIR."
echo "Launcher: $LAUNCHER (active channel: $(cat "$TOUCAN_HOME/channel"))"
echo 'Open a new shell or run: export PATH="'$BIN_DIR':$PATH"'
