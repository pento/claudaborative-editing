import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		include: ['tests/**/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts'],
			reporter: ['text', 'lcov'],
		},
	},
	resolve: {
		alias: {
			'#wordpress': new URL('./src/wordpress', import.meta.url).pathname,
			'#yjs': new URL('./src/yjs', import.meta.url).pathname,
			'#session': new URL('./src/session', import.meta.url).pathname,
			'#tools': new URL('./src/tools', import.meta.url).pathname,
			'#blocks': new URL('./src/blocks', import.meta.url).pathname,
		},
	},
});
