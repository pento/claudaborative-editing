const wpConfig = require('@wordpress/prettier-config');

module.exports = {
	...wpConfig,
	overrides: [
		...wpConfig.overrides,
		{
			files: ['*.jsonc', '.*.jsonc'],
			options: { trailingComma: 'none' },
		},
	],
};
