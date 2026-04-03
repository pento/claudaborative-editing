declare const __PKG_VERSION__: string;

export const VERSION =
	typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.0.0-dev';
