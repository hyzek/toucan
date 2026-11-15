#!/bin/sh
# toucan installer: builds a channel (dev, nightly, or stable) from GitHub into
# TOUCAN_HOME (default ~/.toucan), installs the ~/.toucan/bin/toucan launcher,
# and makes `toucan` work right away (a /usr/local/bin link where writable, a
# PATH block in the shell rc files elsewhere). Re-run to repair or update;
# `toucan install toucan:<name>` and `toucan update` do the same from an installed toucan.
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
REINSTALL="${TOUCAN_REINSTALL:-0}"

case "$CHANNEL" in
	dev | nightly | stable) ;;
	*)
		echo "install.sh: unknown channel '$CHANNEL' (use dev, nightly, or stable)." >&2
		exit 1
		;;
esac

# --- output -----------------------------------------------------------------
# Long steps print one live line each; command noise goes to the log file.

TTY=0
[ -t 1 ] && TTY=1

# The tick/cross glyphs need a UTF-8 locale; fall back to ASCII.
LOCALE="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"
case "$LOCALE" in
	*[Uu][Tt][Ff]*) GLYPH_OK="✔" GLYPH_RUN="·" GLYPH_FAIL="✗" ;;
	*) GLYPH_OK="+" GLYPH_RUN="." GLYPH_FAIL="x" ;;
esac

LOG_FILE=""

line_start() { [ "$TTY" = 1 ] || return 0; printf '\r\033[K  %s %s' "$GLYPH_RUN" "$1"; }
line_done() {
	[ "$TTY" = 1 ] && printf '\r\033[K  \033[32m%s\033[0m %s\n' "$GLYPH_OK" "$1" || printf '  %s %s\n' "$GLYPH_OK" "$1"
}
die() {
	label="$1"
	status="${2:-}"
	[ "$TTY" = 1 ] && printf '\r\033[K  \033[31m%s\033[0m %s\n' "$GLYPH_FAIL" "$label" || printf '  %s %s\n' "$GLYPH_FAIL" "$label" >&2
	if [ "$status" = "137" ]; then
		echo >&2
		echo "The process was killed — likely out of memory. Building from source needs about 768 MB" >&2
		echo "of free memory and swap; add swap or re-run on a larger machine." >&2
	fi
	if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
		echo
		echo "Last lines before the failure:" >&2
		tr '\r' '\n' <"$LOG_FILE" | tail -n 15 | sed 's/^/  /' >&2
		echo >&2
		echo "Full log: $LOG_FILE" >&2
	fi
	exit 1
}

# run_quiet <label> <cmd...> — the label line spins while the command works.
run_quiet() {
	label="$1"
	shift
	line_start "$label"
	"$@" >>"$LOG_FILE" 2>&1 &
	pid=$!
	_wait_and_close "$label" "$pid" 0
}

# run_progress <label> <cmd...> — shows the command's own last output line
# (used for git, whose progress lines arrive carriage-return-separated).
run_progress() {
	label="$1"
	shift
	line_start "$label"
	"$@" >>"$LOG_FILE" 2>&1 &
	pid=$!
	_wait_and_close "$label" "$pid" 1
}

_wait_and_close() {
	label="$1" pid="$2" showlog="$3"
	if [ "$TTY" = 1 ]; then
		i=0
		while kill -0 "$pid" 2>/dev/null; do
			i=$((i + 1))
			case $((i % 4)) in
				0) f="/" ;; 1) f="-" ;; 2) f="\\" ;; *) f="|" ;;
			esac
			if [ "$showlog" = 1 ]; then
				last="$(tr '\r' '\n' <"$LOG_FILE" 2>/dev/null | tail -n 1)"
				[ -n "$last" ] && f=""
			fi
			printf '\r\033[K  %s %s%s' "$f" "$label" "${last:+ $last}"
			[ "$showlog" = 1 ] && unset last
			sleep 0.2
		done
	fi
	wait "$pid" || { status=$?; die "$label" "$status"; }
	line_done "$label"
}

# --- prerequisites ----------------------------------------------------------

need() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "install.sh: $1 is required but was not found on PATH." >&2
		echo "install.sh: on Debian/Ubuntu, install a current Node from https://github.com/nodesource/distributions or use a version manager." >&2
		exit 1
	}
}

echo
echo "toucan installer (channel: $CHANNEL)"
echo

need git
need node
need npm

# Memory precheck: a source build peaks around 768 MB (coding-agent's tsc).
# On Linux, refuse below that instead of letting the OOM killer thrash the box,
# and cap Node's heap so the children stay inside what the machine can hand out
# (Node sizes its default heap to total RAM, which overcommits small boxes).
mem_budget_mb() {
	[ -r /proc/meminfo ] || return 1
	# zram swap is compressed RAM and cannot hold the build's peak: not counted.
	zram=0
	# Only a real /dev/ swap device (not zram) counts as able to hold the peak.
	awk 'NR>1 && $1 ~ /^\/dev\// && $1 !~ /zram/ { found = 1 } END { exit !found }' /proc/swaps 2>/dev/null && zram=0 || zram=1
	awk -v zram="$zram" '
		/^MemAvailable:/ { a = $2 }
		/^SwapFree:/ && !zram { s = $2 }
		END { if (a == "") exit 1; print int((a + s) / 1024) }
	' /proc/meminfo
}
BUDGET_MB="$(mem_budget_mb 2>/dev/null || true)"
if [ -n "$BUDGET_MB" ]; then
	if [ "$BUDGET_MB" -lt 768 ]; then
		echo "install.sh: building toucan from source needs about 768 MB of free memory and swap." >&2
		echo "install.sh: this machine has ${BUDGET_MB} MB. Add swap, or free memory, and retry." >&2
		exit 1
	fi
	[ "$BUDGET_MB" -lt 1536 ] && echo "  ! note: ${BUDGET_MB} MB free memory+swap — capping build heaps to fit"
	if [ "$BUDGET_MB" -lt 3072 ]; then
		CAP_MB=$(( BUDGET_MB * 6 / 10 ))
		[ "$CAP_MB" -gt 1536 ] && CAP_MB=1536
		[ "$CAP_MB" -lt 256 ] && CAP_MB=256
		NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$CAP_MB"
		export NODE_OPTIONS
	fi
fi

BUILDS_DIR="$TOUCAN_HOME/builds"
BUILD_DIR="$BUILDS_DIR/$CHANNEL"
LAUNCHER="$TOUCAN_HOME/bin/toucan"
LOCK_DIR="$BUILDS_DIR/.$CHANNEL.installer.lock"

# The remote: TOUCAN_REPO_URL when set, otherwise the remote this build was cloned from.
# Without that fallback, re-running the installer on a fork or mirror install would
# silently rebuild from the default repository.
if [ -z "${TOUCAN_REPO_URL:-}" ] && [ -f "$BUILD_DIR/channel.json" ]; then
	STORED_REPO_URL="$(node -e 'const url = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).repoUrl; if (typeof url === "string") process.stdout.write(url);' "$BUILD_DIR/channel.json" 2>/dev/null || true)"
	if [ -n "$STORED_REPO_URL" ]; then
		REPO_URL="$STORED_REPO_URL"
	fi
fi
mkdir -p "$BUILDS_DIR/.tmp"
LOG_FILE="$BUILDS_DIR/.tmp/install-$CHANNEL-$(date +%Y%m%d-%H%M%S).log"

if [ -e "$LOCK_DIR" ]; then
	echo "install.sh: another channel operation for $CHANNEL is running ($LOCK_DIR exists)." >&2
	exit 1
fi
mkdir "$LOCK_DIR"
STAGE_DIR=""
OLD_DIR=""
trap 'rm -rf "$LOCK_DIR" "$STAGE_DIR" "$OLD_DIR" 2>/dev/null || true' EXIT

# --- make `toucan` work now ------------------------------------------------------

_setup_path() {
	if [ ! -f "$TOUCAN_HOME/channel" ]; then
		printf '%s\n' "$CHANNEL" >"$TOUCAN_HOME/channel"
	fi

	# A system-wide link makes `toucan` resolve in the current shell right away.
	# TOUCAN_SYSTEM_LINK=0 opts out (also keeps root-run test suites from linking globally).
	SYS_LINK=""
	if [ "${TOUCAN_SYSTEM_LINK:-1}" = "1" ] && [ -w /usr/local/bin ]; then
		ln -sf "$LAUNCHER" /usr/local/bin/toucan
		SYS_LINK="/usr/local/bin/toucan"
	fi

	BIN_DIR="$TOUCAN_HOME/bin"
	MARKER_BEGIN="# >>> toucan channel launcher >>>"
	MARKER_END="# <<< toucan channel launcher <<<"
	add_to_rc() {
		rc="$1"
		[ -f "$rc" ] || return 0
		if grep -qF "$MARKER_BEGIN" "$rc" 2>/dev/null; then return 0; fi
		printf '\n%s\nexport PATH="%s:$PATH"\n%s\n' "$MARKER_BEGIN" "$BIN_DIR" "$MARKER_END" >>"$rc"
		RC_ADDED="$rc"
	}
	RC_ADDED=""
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
	[ -n "$RC_ADDED" ] && line_done "PATH added to $RC_ADDED (for new shells)"
	[ -n "$SYS_LINK" ] && line_done "Linked into PATH: $SYS_LINK"

	if command -v toucan >/dev/null 2>&1 && [ "$(command -v toucan)" != "$LAUNCHER" ] && [ "$(command -v toucan)" != "/usr/local/bin/toucan" ]; then
		echo "  ! note: '$(command -v toucan)' comes earlier on your PATH and may shadow the launcher."
	fi

	echo
	echo "toucan $CHANNEL ($REF ${COMMIT%"${COMMIT#???????}"}) is ready — type: toucan"
	if [ -z "$SYS_LINK" ]; then
		echo "Open a new shell or run: export PATH=\"$TOUCAN_HOME/bin:\$PATH\""
	fi
	echo
}

# --- resolve the ref ---------------------------------------------------------

line_start "Resolving $CHANNEL..."
if [ "$CHANNEL" = "stable" ]; then
	REF="$(git ls-remote --tags "$REPO_URL" 'refs/tags/b*' 2>>"$LOG_FILE" | sed -n 's|.*refs/tags/\(b[0-9][0-9]*\)$|\1|p' | sort -V | tail -n 1)"
	[ -n "$REF" ] || die "Resolving $CHANNEL: no b<N> release tags found in $REPO_URL."
else
	REF="$CHANNEL"
	git ls-remote --exit-code "$REPO_URL" "refs/heads/$REF" >>"$LOG_FILE" 2>&1 || die "Resolving $CHANNEL: branch $REF does not exist in $REPO_URL."
fi
COMMIT="$(git ls-remote "$REPO_URL" "refs/tags/$REF" "refs/heads/$REF" 2>>"$LOG_FILE" | sed -n '1{s|\([0-9a-f]*\)\s.*|\1|p;}')"
line_done "Resolved $CHANNEL to $REF (${COMMIT%"${COMMIT#???????}"})"

# --- already up to date? -------------------------------------------------------

# channel.json is written by the previous build; when its commit still heads
# the ref, only the launcher and PATH wiring need re-checking.
if [ "$REINSTALL" != "1" ] && [ -f "$BUILD_DIR/channel.json" ]; then
	BUILT_COMMIT="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).commit)' "$BUILD_DIR/channel.json" 2>/dev/null || true)"
	if [ -n "$BUILT_COMMIT" ] && [ "$BUILT_COMMIT" = "$COMMIT" ]; then
		line_done "Already at $REF (${COMMIT%"${COMMIT#???????}"}) — repairing launcher and PATH"
		CHANNEL="$CHANNEL" REF="$REF" COMMIT="$COMMIT" REPO_URL="$REPO_URL" node -e '
			const [home, channel, ref, commit, repoUrl] = process.argv.slice(1);
			const info = { kind: "toucan-channel", schemaVersion: 1, channel, ref, commit, builtAt: new Date().toISOString(), node: process.version, repoUrl };
			require("node:fs").writeFileSync(home + "/builds/" + channel + "/channel.json", JSON.stringify(info, null, "\t") + "\n");
		' "$TOUCAN_HOME" "$CHANNEL" "$REF" "$COMMIT" "$REPO_URL"
		TOUCAN_HOME="$TOUCAN_HOME" node "$BUILD_DIR/packages/coding-agent/dist/bundle/cli.js" launcher >>"$LOG_FILE" 2>&1 || die "Installing the launcher"
		_setup_path
		exit 0
	fi
fi

# --- build ---------------------------------------------------------------------

# --filter=tree:0 keeps the full commit graph (no tree/blob data): toucan derives
# its build name from `git rev-list --count HEAD`, and a --depth 1 clone would answer 1.
STAGE_DIR="$(mktemp -d "$BUILDS_DIR/.tmp/$CHANNEL-installer-XXXXXX")"
OLD_DIR="$BUILD_DIR.old-installer"

run_progress "Downloading $REF..." git clone --progress --filter=tree:0 --branch "$REF" "$REPO_URL" "$STAGE_DIR"

REQUIRED_NODE="$(sed -n 's/.*"node": *">=\([0-9][0-9.]*\)".*/\1/p' "$STAGE_DIR/package.json" | head -n 1)"
CURRENT_NODE="$(node -p 'process.version.slice(1)')"
if [ -n "$REQUIRED_NODE" ] && [ "$(printf '%s\n%s\n' "$REQUIRED_NODE" "$CURRENT_NODE" | sort -V | head -n 1)" != "$REQUIRED_NODE" ]; then
	die "This build requires Node >=$REQUIRED_NODE, but this is $CURRENT_NODE. Install a newer Node and retry."
fi
line_done "Node $CURRENT_NODE satisfies >=$REQUIRED_NODE"

run_quiet "Installing dependencies..." npm --prefix "$STAGE_DIR" ci --ignore-scripts
# The monorepo root build carries the canonical workspace order.
run_quiet "Building toucan..." npm --prefix "$STAGE_DIR" run build

ENTRY="$STAGE_DIR/packages/coding-agent/dist/bundle/cli.js"
[ -f "$ENTRY" ] || die "The build finished but dist/bundle/cli.js is missing."
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
STAGE_DIR=""
line_done "Installed to $BUILD_DIR"

TOUCAN_HOME="$TOUCAN_HOME" node "$BUILD_DIR/packages/coding-agent/dist/bundle/cli.js" launcher >>"$LOG_FILE" 2>&1 || die "Installing the launcher"
line_done "Launcher: $LAUNCHER"

_setup_path
