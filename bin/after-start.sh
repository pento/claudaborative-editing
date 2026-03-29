#!/bin/sh
set -e

hash=$(printf '%s' "$(pwd)/.wp-env.json" | md5sum | cut -d' ' -f1)
cd ~/.wp-env/"$hash"/gutenberg

GIT_TERMINAL_PROMPT=0 git pull --ff-only
npm install
npm run build

cd - > /dev/null
npx wp-env run cli wp plugin activate gutenberg claudaborative-editing
npx wp-env run cli wp option update wp_collaboration_enabled 1
