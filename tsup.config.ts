import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
	version: string;
};

const shared: {
	format: ['esm'];
	target: 'node20';
	outDir: string;
	sourcemap: boolean;
	dts: boolean;
	define: Record<string, string>;
} = {
	format: ['esm'],
	target: 'node20',
	outDir: 'dist',
	sourcemap: true,
	dts: true,
	define: {
		__PKG_VERSION__: JSON.stringify(pkg.version),
	},
};

export default defineConfig([
	// CLI entry (single bundle with shebang)
	{
		...shared,
		entry: ['src/index.ts'],
		clean: true,
		splitting: false,
		banner: {
			js: '#!/usr/bin/env node',
		},
	},
	// Library entries (importable subpath exports, no shebang)
	{
		...shared,
		entry: {
			'tools/definitions': 'src/tools/definitions.ts',
			'tools/registry': 'src/tools/registry.ts',
			'prompts/definitions': 'src/prompts/definitions.ts',
			'prompts/registry': 'src/prompts/registry.ts',
			'prompts/prompt-content': 'src/prompts/prompt-content.ts',
			'session/session-manager': 'src/session/session-manager.ts',
			'server-instructions': 'src/server-instructions.ts',
			'shared/commands': 'shared/commands.ts',
		},
		clean: false,
		splitting: false,
	},
]);
