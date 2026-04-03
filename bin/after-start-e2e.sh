#!/bin/sh
set -e

npx wp-env --config .wp-env.test.json run cli --env-cwd=wp-content/plugins/claudaborative-editing composer install --no-interaction --prefer-dist

npm run build:all

npx wp-env --config .wp-env.test.json run cli wp plugin activate gutenberg claudaborative-editing
npx wp-env --config .wp-env.test.json run cli wp option update wp_collaboration_enabled 1
