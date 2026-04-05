const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');

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
};
