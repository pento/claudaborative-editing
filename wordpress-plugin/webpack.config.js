const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');
const webpack = require('webpack');

// Treat any non-empty value except '0' / 'false' (case-insensitive) as truthy
// so CI configs can use WPCE_TEST_HATCH=1, =true, =yes, etc. interchangeably.
const testHatchRaw = process.env.WPCE_TEST_HATCH;
const testHatchEnabled =
	Boolean(testHatchRaw) &&
	testHatchRaw !== '0' &&
	testHatchRaw.toLowerCase() !== 'false';

module.exports = {
	...defaultConfig,
	resolve: {
		...defaultConfig.resolve,
		alias: {
			...defaultConfig.resolve?.alias,
			'#shared': path.resolve(__dirname, '../shared'),
			// Redirect @wordpress/interface imports to our lightweight shim
			// that re-exports only the components (PinnedItems, etc.)
			// without importing the store module. The store import triggers
			// a "core/interface is already registered" warning because
			// @wordpress/scripts bundles this package (BUNDLED_PACKAGES)
			// and WordPress core already registers the store.
			'@wordpress/interface': path.resolve(
				__dirname,
				'src/shims/wordpress-interface.ts'
			),
		},
	},
	// `y-protocols/awareness` (bundled into the test-hatch chunk for its
	// standalone encode/applyAwarenessUpdate, which @wordpress/sync does not
	// re-export) internally does `import * as Y from 'yjs'`. Without this
	// external, a non-tree-shaken (dev) build would pull a SECOND real yjs
	// next to the one @wordpress/sync ships — the dual-instance trap the
	// project pins yjs to avoid. `wp.sync.Y` is that very same yjs namespace,
	// so map bare `yjs` onto it for a single instance in every build mode.
	externals: {
		...defaultConfig.externals,
		yjs: ['wp', 'sync', 'Y'],
	},
	plugins: [
		...(defaultConfig.plugins || []),
		new webpack.DefinePlugin({
			'process.env.WPCE_TEST_HATCH': JSON.stringify(
				testHatchEnabled ? 'true' : 'false'
			),
		}),
	],
};
