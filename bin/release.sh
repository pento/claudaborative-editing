#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# --- Helpers ---

die() {
	echo "Error: $*" >&2
	exit 1
}

confirm() {
	read -r -p "$1 [y/N] " response
	[[ "$response" =~ ^[Yy]$ ]] || die "Aborted."
}

# --- Validate arguments ---

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
	echo "Usage: bin/release.sh <version>"
	echo "  e.g. bin/release.sh 0.2.0"
	exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	die "Version must be in X.Y.Z format (got '$VERSION')."
fi

# --- Preconditions ---

cd "$PROJECT_DIR"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
	die "Must be on the main branch (currently on '$CURRENT_BRANCH')."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
	die "Working tree is dirty. Commit or stash changes first."
fi

git fetch origin --tags
if git rev-parse "refs/tags/v$VERSION" &>/dev/null; then
	die "Tag 'v$VERSION' already exists."
fi

# --- Check changelog ---

CHANGELOG=$(awk -v ver="$VERSION" '
	/^= / { if (found) exit; if ($0 == "= " ver " =") found=1; next }
	found { print }
' wordpress-plugin/readme.txt)

if [[ -z "$CHANGELOG" ]]; then
	die "No changelog entry found for version $VERSION in wordpress-plugin/readme.txt. Add one before releasing."
fi

echo ""
echo "=== Changelog for $VERSION ==="
echo "$CHANGELOG"
echo "=============================="
echo ""

# --- Show what will change ---

CURRENT_VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json | head -1)
echo "Version bump: $CURRENT_VERSION → $VERSION"
echo ""
echo "Files to update:"
echo "  - package.json"
echo "  - package-lock.json"
echo "  - wordpress-plugin/package.json"
echo "  - wordpress-plugin/package-lock.json"
echo "  - wordpress-plugin/claudaborative-editing.php"
echo "  - wordpress-plugin/readme.txt"
echo ""

confirm "Proceed with release $VERSION?"

# --- Bump versions ---

# Root package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Root package-lock.json
npm install --package-lock-only

# WordPress plugin package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" wordpress-plugin/package.json

# WordPress plugin package-lock.json
cd wordpress-plugin
npm install --package-lock-only
cd "$PROJECT_DIR"

# WordPress plugin PHP header
sed -i '' "s/\* Version: .*/\* Version: $VERSION/" wordpress-plugin/claudaborative-editing.php

# WordPress plugin readme.txt
sed -i '' "s/Stable tag: .*/Stable tag: $VERSION/" wordpress-plugin/readme.txt

# --- Commit, tag, push ---

git add package.json package-lock.json \
	wordpress-plugin/package.json wordpress-plugin/package-lock.json \
	wordpress-plugin/claudaborative-editing.php wordpress-plugin/readme.txt

git commit -m "chore: bump version to $VERSION."

git tag "v$VERSION"

echo ""
echo "Version $VERSION committed and tagged."
echo ""
confirm "Push to origin?"

git push origin main
git push origin "v$VERSION"

echo ""
echo "Release v$VERSION pushed. The publish workflow will create the GitHub release."
