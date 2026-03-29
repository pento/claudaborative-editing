#!/bin/sh
set -e

if [ "$1" = "--build-gutenberg" ]; then
    echo "Building Gutenberg from source..."
	hash=$(printf '%s' "$(pwd)/.wp-env.json" | md5sum | cut -d' ' -f1)
	cd ~/.wp-env/"$hash"/gutenberg

	GIT_TERMINAL_PROMPT=0 git pull --ff-only
	npm install
	npm run build

	cd - > /dev/null
fi

if [ "$1" = "--test-env" ]; then
	npx wp-env --config .wp-env.test.json run cli --env-cwd=wp-content/plugins/claudaborative-editing composer install --no-interaction --prefer-dist
	npx wp-env --config .wp-env.test.json run cli wp plugin activate gutenberg claudaborative-editing
	npx wp-env --config .wp-env.test.json run cli wp option update wp_collaboration_enabled 1
else
	npx wp-env run cli wp plugin activate gutenberg claudaborative-editing
	npx wp-env run cli wp option update wp_collaboration_enabled 1
fi
