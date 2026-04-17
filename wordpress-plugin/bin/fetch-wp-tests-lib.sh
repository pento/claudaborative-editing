#!/usr/bin/env bash
#
# Fetch the WordPress PHPUnit test library (tests/phpunit from wordpress-develop)
# into wordpress-plugin/.wp-tests-lib/ so it can be mounted into Playground when
# running PHPUnit.
#
# Idempotent: skips the clone if the library is already present. Re-run after
# deleting .wp-tests-lib/ to refresh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
LIB_DIR="$PLUGIN_DIR/.wp-tests-lib"
BRANCH="${WP_TESTS_BRANCH:-trunk}"

if [ -f "$LIB_DIR/includes/bootstrap.php" ]; then
	exit 0
fi

echo "Fetching WordPress test library (branch: $BRANCH) → $LIB_DIR"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/claudaborative-wp-tests-lib.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

git clone \
	--depth 1 \
	--branch "$BRANCH" \
	--filter=blob:none \
	--sparse \
	https://github.com/WordPress/wordpress-develop.git \
	"$TMP/src" >/dev/null 2>&1

(cd "$TMP/src" && git sparse-checkout set tests/phpunit >/dev/null)

mkdir -p "$LIB_DIR"
cp -R "$TMP/src/tests/phpunit/." "$LIB_DIR/"

echo "WordPress test library ready."
