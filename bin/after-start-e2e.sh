#!/bin/sh
set -e

npm run build
npm --prefix wordpress-plugin run build

npx wp-env --config .wp-env.test.json run cli wp plugin activate gutenberg claudaborative-editing
npx wp-env --config .wp-env.test.json run cli wp option update wp_collaboration_enabled 1
